import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import BroadcastButton from './components/BroadcastButton';
import BroadcastList from './components/BroadcastList';
import './App.css';


function App() {
  const [socket, setSocket] = useState(null);
  const [device, setDevice] = useState(null);
  const [broadcasts, setBroadcasts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect to server - use network IP for phone access
    // const serverUrl = 'http://10.121.158.190:3001';
    const serverUrl = 'http://192.168.43.230:3001'; 
    // const serverUrl = 'http://localhost:3001';
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    newSocket.on('connect', async () => {
      console.log('Connected to server');
      setIsConnected(true);

      try {
        const newDevice = new Device();

        const routerRtpCapabilities = await new Promise((resolve) => {
          newSocket.emit('getRouterRtpCapabilities', resolve);
        });

        await newDevice.load({ routerRtpCapabilities });
        setDevice(newDevice);

        console.log('Mediasoup device initialized');

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

    newSocket.on('broadcastList', (broadcastList) => {
      setBroadcasts(broadcastList);
      console.log('Broadcast list updated:', broadcastList);
    });

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
            <BroadcastButton socket={socket} device={device} />

            <BroadcastList socket={socket} device={device} broadcasts={broadcasts} />
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>Simple one-to-many broadcast system.</p>
      </footer>
    </div>
  );
}

export default App;
