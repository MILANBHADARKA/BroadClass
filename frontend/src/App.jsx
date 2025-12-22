import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import BroadcastButton from './components/BroadcastButton';
import BroadcastList from './components/BroadcastList';
import './App.css';

/**
 * Main App Component
 * Manages Socket.IO connection, mediasoup device, and broadcast state
 */
function App() {
  const [socket, setSocket] = useState(null);
  const [device, setDevice] = useState(null);
  const [broadcasts, setBroadcasts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  /**
   * Initialize Socket.IO connection and mediasoup device on component mount
   */
  useEffect(() => {
    // Connect to server - use network IP for phone access
    // const serverUrl = 'http://10.121.158.190:3001';
    const serverUrl = 'http://192.168.1.68:3001'; 
    // const serverUrl = 'http://localhost:3001';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', async () => {
      console.log('Connected to server');
      setIsConnected(true);

      // Initialize mediasoup device
      try {
        const newDevice = new Device();

        // Get router RTP capabilities from server
        const routerRtpCapabilities = await new Promise((resolve) => {
          newSocket.emit('getRouterRtpCapabilities', resolve);
        });

        // Load device with router capabilities
        await newDevice.load({ routerRtpCapabilities });
        setDevice(newDevice);

        console.log('Mediasoup device initialized');

        // Get initial list of broadcasts
        newSocket.emit('getBroadcasts', (broadcastList) => {
          setBroadcasts(broadcastList);
        });

      } catch (error) {
        console.error('Error initializing device:', error);
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    // Listen for broadcast list updates
    newSocket.on('broadcastList', (broadcastList) => {
      setBroadcasts(broadcastList);
      console.log('Broadcast list updated:', broadcastList);
    });

    // Cleanup on component unmount
    return () => {
      newSocket.close();
    };
  }, []);

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
        </div>
      </header>

      <main className="app-main">
        {!device ? (
          <div className="loading">
            <p>Initializing mediasoup device...</p>
          </div>
        ) : (
          <>
            {/* Broadcast button component */}
            <BroadcastButton socket={socket} device={device} />

            {/* List of active broadcasts */}
            <BroadcastList socket={socket} device={device} broadcasts={broadcasts} />
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>Simple one-to-many broadcast system powered by mediasoup</p>
      </footer>
    </div>
  );
}

export default App;
