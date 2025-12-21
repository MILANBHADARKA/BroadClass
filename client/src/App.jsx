import { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import Room from './components/Room';
import WebRTCClient from './utils/webrtc';
import './App.css';

// Change 'localhost' to your server's IP address for network access
// For local: ws://localhost:3000
// For network: ws://192.168.43.230:3000 (use your server's actual IP)
const WS_URL = window.location.hostname === 'localhost' 
  ? 'ws://localhost:3000'
  : `ws://${window.location.hostname}:3000`;

function App() {
  const [client] = useState(() => new WebRTCClient());
  const [currentScreen, setCurrentScreen] = useState('lobby');
  const [roomId, setRoomId] = useState(null);
  const [isInstructor, setIsInstructor] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [messages, setMessages] = useState([]);
  const [remoteVideos, setRemoteVideos] = useState(new Map());

  useEffect(() => {
    // Connect to server
    const connectToServer = async () => {
      try {
        await client.connect(WS_URL);
        console.log('Connected to server');
        setupClientCallbacks();
      } catch (error) {
        console.log('Failed to connect:', error);
        alert('Failed to connect to server. Please make sure the server is running.');
      }
    };

    connectToServer();

    return () => {
      // Cleanup on unmount
      if (client.ws) {
        client.ws.close();
      }
    };
  }, [client]);

  const setupClientCallbacks = () => {
    client.callbacks.onRoomCreated = (data) => {
      console.log('Room created:', data);
      setRoomId(data.roomId);
      setIsInstructor(true);
      setCurrentScreen('room');
    };

    client.callbacks.onRoomJoined = (data) => {
      console.log('Room joined:', data);
      setRoomId(data.roomId);
      setIsInstructor(false);
      setCurrentScreen('room');
      setParticipantCount(data.participantCount);
    };

    client.callbacks.onParticipantJoined = (data) => {
      console.log('Participant joined:', data);
      setParticipantCount(data.participantCount);
      addChatMessage('System', `${data.name} joined the room.`, true);
    };

    client.callbacks.onParticipantLeft = (data) => {
      console.log('Participant left:', data);
      setParticipantCount(data.participantCount);
      
      // Remove remote video
      setRemoteVideos(prev => {
        const newMap = new Map(prev);
        newMap.delete(data.participantId);
        return newMap;
      });
    };

    client.callbacks.onNewProducer = async (data) => {
      console.log('New producer:', data);
      await consumeMedia(data.producerId, data.participantId, data.kind, data.isInstructor);
    };

    client.callbacks.onChatMessage = (data) => {
      addChatMessage(data.name, data.message, false, data.timestamp);
    };

    client.callbacks.onError = (error) => {
      console.error('WebRTC error:', error);
      alert(`Error: ${error}`);
    };
  };

  const addChatMessage = (name, message, isSystem = false, timestamp = new Date().toISOString()) => {
    setMessages(prev => [...prev, { name, message, isSystem, timestamp }]);
  };

  const consumeMedia = async (producerId, participantId, kind, isInstructor) => {
    try {
      console.log(`[App] Starting to consume ${kind} from ${participantId}, producer: ${producerId}`);
      const consumer = await client.consume(producerId);
      const track = consumer.track;
      
      console.log(`[App] Consumer created, track:`, track);
      
      setRemoteVideos(prev => {
        const newMap = new Map(prev);
        let videoData = newMap.get(participantId);
        
        if (!videoData) {
          videoData = {
            isInstructor,
            stream: new MediaStream(),
          };
          newMap.set(participantId, videoData);
          console.log(`[App] Created new remote video for ${participantId}`);
        }
        
        videoData.stream.addTrack(track);
        console.log(`[App] Added ${kind} track to stream. Total tracks:`, videoData.stream.getTracks().length);
        return new Map(newMap);
      });
      
      console.log(`[App] Successfully consuming ${kind} from ${participantId}`);
    } catch (error) {
      console.error('Error consuming media:', error);
    }
  };

  const handleCreateRoom = async (username) => {
    try {
      await client.createRoom(username);
    } catch (error) {
      console.error('Error creating room:', error);
      alert('Failed to create room');
    }
  };

  const handleJoinRoom = async (roomId, username) => {
    try {
      await client.joinRoom(roomId, username);
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join room');
    }
  };

  const handleLeaveRoom = () => {
    setCurrentScreen('lobby');
    setRoomId(null);
    setIsInstructor(false);
    setParticipantCount(1);
    setMessages([]);
    setRemoteVideos(new Map());
  };

  return (
    <div className="app">
      {currentScreen === 'lobby' && (
        <Lobby onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} />
      )}
      {currentScreen === 'room' && (
        <Room
          client={client}
          roomId={roomId}
          isInstructor={isInstructor}
          onLeave={handleLeaveRoom}
          participantCount={participantCount}
          messages={messages}
          remoteVideos={remoteVideos}
          onSendMessage={(msg) => client.sendChatMessage(msg)}
        />
      )}
    </div>
  );
}

export default App;
