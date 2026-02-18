import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import BroadcastButton from './components/BroadcastButton';
import BroadcastList from './components/BroadcastList';
import './App.css';

//SERVER CONFIGURATION
// In production, this would be loaded from environment variables
const ORIGIN_SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

function App() {
  const [socket, setSocket] = useState(null);
  const [device, setDevice] = useState(null);
  const [broadcasts, setBroadcasts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [currentServer, setCurrentServer] = useState(null);

  useEffect(() => {
    // Connect to server using load balancer
    initializeConnection();
  }, []);

  const initializeConnection = async () => {
    try {
      console.log(`📡 Initializing connection to ${ORIGIN_SERVER}`);
      
      // Always connect to origin first to get capabilities
      const newSocket = io(ORIGIN_SERVER);
      setSocket(newSocket);

      newSocket.on('connect', async () => {
        console.log('✅ Connected to Origin server');
        setIsConnected(true);

        try {
          const newDevice = new Device();

          const routerRtpCapabilities = await new Promise((resolve) => {
            newSocket.emit('getRouterRtpCapabilities', resolve);
          });

          await newDevice.load({ routerRtpCapabilities });
          setDevice(newDevice);

          // Store origin as default server
          setCurrentServer({
            ip: new URL(ORIGIN_SERVER).hostname,
            port: parseInt(new URL(ORIGIN_SERVER).port || 3001),
            isOrigin: true
          });

          console.log('✅ Mediasoup device initialized');

          newSocket.emit('getBroadcasts', (broadcastList) => {
            setBroadcasts(broadcastList);
          });
        } catch (error) {
          console.error('❌ Error initializing device:', error);
        }
      });

      newSocket.on('disconnect', () => {
        console.log('👋 Disconnected from server');
        setIsConnected(false);
      });

      newSocket.on('broadcastList', (broadcastList) => {
        setBroadcasts(broadcastList);
        console.log('📺 Broadcast list updated:', broadcastList);
      });

    } catch (error) {
      console.error('❌ Failed to initialize connection:', error);
    }
  };

  /**
   * Get best edge server for a specific broadcast
   * Called when a student clicks "Join Broadcast"
   */
  const getBestEdgeServer = async (roomId) => {
    try {
      const response = await fetch(`${ORIGIN_SERVER}/api/best-server?roomId=${roomId}`);
      
      if (!response.ok) {
        console.warn(`⚠️ Could not get best edge, using origin: ${response.status}`);
        return currentServer; // Fallback to origin/current
      }

      const edgeData = await response.json();
      
      console.log(`🎯 Best edge for ${roomId}:`, edgeData);

      return {
        ip: edgeData.edgeIp,
        port: edgeData.edgePort,
        rtcCapabilities: edgeData.rtcCapabilities,
        isOrigin: edgeData.isOrigin || false,
        load: edgeData.load
      };

    } catch (error) {
      console.error('❌ Error getting best edge server:', error);
      return currentServer; // Fallback to current
    }
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>One to Many Broadcast</h1>
        <div className="connection-status">
          {isConnected ? (
            <span className="status-connected">🟢 Connected</span>
          ) : (
            <span className="status-disconnected">🔴 Disconnected</span>
          )}
          {currentServer && (
            <span className="current-server">
              {currentServer.isOrigin ? '🌍 Origin' : '🔗 Edge'}: {currentServer.ip}:{currentServer.port}
            </span>
          )}
        </div>
      </header>

      <main className="app-main">
        {!device ? (
          <div className="loading">
            <p>🔄 Initializing mediasoup device...</p>
          </div>
        ) : (
          <>
            <BroadcastButton socket={socket} device={device} />

            <BroadcastList 
              socket={socket} 
              device={device} 
              broadcasts={broadcasts}
              onJoinBroadcast={getBestEdgeServer}
              originServer={ORIGIN_SERVER}
            />
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>📡 Distributed one-to-many broadcast system with scalable edge servers.</p>
      </footer>
    </div>
  );
}

export default App;

