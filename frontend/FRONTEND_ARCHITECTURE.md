# Frontend Architecture Documentation

## Overview

This frontend application is a React-based client for the mediasoup broadcast system. It allows users to either broadcast their camera/microphone to create a one-to-many stream, or view existing broadcasts in real-time.

**Key Features:**
- Start/stop broadcasting with camera and microphone
- View list of active broadcasts
- Join and watch any active broadcast
- Responsive design for mobile and desktop
- Real-time updates via Socket.IO

---

## Technology Stack

- **React 19.2**: UI framework with hooks
- **Vite**: Fast build tool and dev server
- **Socket.IO Client**: Real-time communication with server
- **mediasoup-client**: WebRTC client library
- **CSS**: Custom responsive styling

---

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx                 # Main app component, Socket.IO & device setup
│   ├── App.css                 # App-level styles
│   ├── components/
│   │   ├── BroadcastButton.jsx # Broadcasting component
│   │   ├── BroadcastButton.css # Broadcaster styles
│   │   ├── BroadcastList.jsx   # Viewer component
│   │   └── BroadcastList.css   # Viewer styles
│   ├── main.jsx                # React entry point
│   └── index.css               # Global styles
├── vite.config.js              # Vite configuration (HTTPS, host)
├── package.json                # Dependencies
└── public/                     # Static assets
```

---

## Core Components

### 1. App.jsx - Main Application

**Responsibilities:**
- Establish Socket.IO connection to server
- Initialize mediasoup Device with router capabilities
- Manage global state (socket, device, broadcasts list)
- Listen for broadcast list updates
- Render child components

**State:**
```javascript
const [socket, setSocket] = useState(null);        // Socket.IO connection
const [device, setDevice] = useState(null);        // mediasoup Device
const [broadcasts, setBroadcasts] = useState([]); // List of active room IDs
const [isConnected, setIsConnected] = useState(false); // Connection status
```

**Lifecycle:**
1. On mount: Connect to server
2. On connect: Initialize mediasoup device
3. Listen for broadcast list updates
4. On unmount: Close socket connection

---

### 2. BroadcastButton.jsx - Broadcasting Component

**Responsibilities:**
- Get user media (camera/microphone)
- Create producer transport
- Send media to server
- Display local video preview
- Handle broadcast start/stop

**State:**
```javascript
const [isBroadcasting, setIsBroadcasting] = useState(false); // Broadcast status
const [roomId, setRoomId] = useState('');                    // Room identifier
const [localStream, setLocalStream] = useState(null);        // MediaStream
const localVideoRef = useRef(null);                          // Video element ref
```

**Flow:**
1. User enters room ID
2. User clicks "Start Broadcast"
3. Request camera/microphone permissions
4. Create producer transport (with roomId)
5. Produce video and audio tracks
6. Display local preview
7. On stop: Close tracks and notify server

---

### 3. BroadcastList.jsx - Viewer Component

**Responsibilities:**
- Display list of active broadcasts
- Join selected broadcast
- Create consumer transport
- Consume video/audio streams
- Display remote video
- Handle broadcast end notifications

**State:**
```javascript
const [viewingRoom, setViewingRoom] = useState(null);     // Currently viewing room
const [remoteStream, setRemoteStream] = useState(null);   // MediaStream from broadcaster
const remoteVideoRef = useRef(null);                       // Video element ref
```

**Flow:**
1. User sees list of broadcasts
2. User clicks "View Broadcast"
3. Join broadcast on server
4. Create consumer transport (with roomId)
5. Consume video and audio
6. Display remote video
7. On stop: Close stream and clean up

---

## mediasoup Client Flow

### Device Initialization

```javascript
// 1. Create Device
const device = new Device();

// 2. Get router RTP capabilities from server
const routerRtpCapabilities = await socket.emit('getRouterRtpCapabilities');

// 3. Load device with capabilities
await device.load({ routerRtpCapabilities });
```

**Purpose**: Device needs to know what codecs the server supports before creating transports.

---

### Broadcasting Flow (Producer)

#### Step 1: Get User Media

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
});
```

**Notes:**
- Requires HTTPS on mobile browsers
- User must grant permissions
- Returns MediaStream with video and audio tracks

#### Step 2: Create Producer Transport

```javascript
// Request transport from server (include roomId)
const transportData = await socket.emit('createWebRtcTransport', { 
  sender: true, 
  roomId 
});

// Create send transport on client device
const producerTransport = device.createSendTransport(transportData);
```

**Transport Data Includes:**
- `id`: Transport ID
- `iceParameters`: ICE configuration
- `iceCandidates`: ICE candidates
- `dtlsParameters`: DTLS configuration

#### Step 3: Handle Transport Events

```javascript
// Connect event - establish DTLS connection
producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
  await socket.emit('connectTransport', { transportId, dtlsParameters });
  callback();
});

// Produce event - server creates producer
producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
  const { producerId } = await socket.emit('startBroadcast', { 
    roomId, 
    rtpParameters, 
    kind 
  });
  callback({ id: producerId });
});
```

#### Step 4: Produce Media Tracks

```javascript
// Produce video
const videoTrack = stream.getVideoTracks()[0];
await producerTransport.produce({ track: videoTrack });

// Produce audio
const audioTrack = stream.getAudioTracks()[0];
await producerTransport.produce({ track: audioTrack });
```

**Result**: Media is now flowing to the server!

---

### Viewing Flow (Consumer)

#### Step 1: Join Broadcast

```javascript
await socket.emit('joinBroadcast', { roomId });
```

#### Step 2: Create Consumer Transport

```javascript
// Request transport from server (include roomId)
const transportData = await socket.emit('createWebRtcTransport', { 
  sender: false, 
  roomId 
});

// Create receive transport on client device
const consumerTransport = device.createRecvTransport(transportData);
```

#### Step 3: Handle Transport Events

```javascript
// Connect event - establish DTLS connection
consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
  await socket.emit('connectTransport', { transportId, dtlsParameters });
  callback();
});
```

#### Step 4: Consume Media

```javascript
const stream = new MediaStream();

// Consume video
const videoData = await socket.emit('consume', {
  roomId,
  rtpCapabilities: device.rtpCapabilities,
  kind: 'video'
});

const videoConsumer = await consumerTransport.consume({
  id: videoData.id,
  producerId: videoData.producerId,
  kind: videoData.kind,
  rtpParameters: videoData.rtpParameters
});

stream.addTrack(videoConsumer.track);

// Consume audio (same process)
const audioData = await socket.emit('consume', { roomId, rtpCapabilities, kind: 'audio' });
const audioConsumer = await consumerTransport.consume({ ...audioData });
stream.addTrack(audioConsumer.track);

// Attach stream to video element
videoElement.srcObject = stream;
```

**Result**: Remote video/audio is now playing!

---

## Socket.IO Events (Client Side)

### Emitted Events (Client → Server)

| Event | Parameters | Purpose |
|-------|-----------|---------|
| `getRouterRtpCapabilities` | - | Get server's codec capabilities |
| `createWebRtcTransport` | `{ sender, roomId }` | Create transport for sending or receiving |
| `connectTransport` | `{ transportId, dtlsParameters }` | Complete WebRTC handshake |
| `startBroadcast` | `{ roomId, rtpParameters, kind }` | Create producer for media |
| `getBroadcasts` | - | Get list of active broadcasts |
| `joinBroadcast` | `{ roomId }` | Join a broadcast as viewer |
| `consume` | `{ roomId, rtpCapabilities, kind }` | Create consumer for media |
| `stopBroadcast` | `{ roomId }` | Stop broadcasting |

### Listened Events (Server → Client)

| Event | Data | Purpose |
|-------|------|---------|
| `connect` | - | Socket connected to server |
| `disconnect` | - | Socket disconnected from server |
| `broadcastList` | `[roomIds]` | Updated list of active broadcasts |
| `broadcastEnded` | `{ roomId }` | A broadcast has ended |

---

## React Hooks Usage

### useState

```javascript
// Socket and device management
const [socket, setSocket] = useState(null);
const [device, setDevice] = useState(null);

// UI state
const [isBroadcasting, setIsBroadcasting] = useState(false);
const [viewingRoom, setViewingRoom] = useState(null);

// Media streams
const [localStream, setLocalStream] = useState(null);
const [remoteStream, setRemoteStream] = useState(null);
```

### useEffect

```javascript
// Initialize on mount
useEffect(() => {
  // Connect socket
  // Initialize device
  
  return () => {
    // Cleanup: close socket
  };
}, []); // Empty deps = run once

// React to stream changes
useEffect(() => {
  if (videoRef.current && stream) {
    videoRef.current.srcObject = stream;
    videoRef.current.play();
  }
}, [stream]); // Re-run when stream changes
```

### useRef

```javascript
const localVideoRef = useRef(null);

// Access DOM element directly
localVideoRef.current.srcObject = stream;
localVideoRef.current.play();
```

**Why useRef?**
- Direct DOM manipulation for video elements
- Doesn't trigger re-renders when value changes
- Persists across renders

---

## Video Element Management

### Local Video (Broadcaster)

```jsx
<video
  ref={localVideoRef}
  autoPlay
  muted           // Prevent echo
  playsInline     // Required for iOS
  controls        // Show controls for debugging
  className="video-element"
/>
```

**CSS Styling:**
```css
.broadcast-section .video-element {
  transform: scaleX(-1);  /* Mirror effect */
  object-fit: contain;    /* Maintain aspect ratio */
  min-height: 400px;      /* Ensure visibility */
}
```

### Remote Video (Viewer)

```jsx
<video
  ref={remoteVideoRef}
  autoPlay
  playsInline
  controls
  className="video-element"
/>
```

**Note**: Not muted - viewer hears the audio

---

## Responsive Design

### Mobile Breakpoint

```css
@media (max-width: 768px) {
  /* Adjustments for mobile */
}
```

### Key Mobile Optimizations

1. **Stacked Layouts**
   ```css
   .broadcast-controls {
     flex-direction: column;
   }
   ```

2. **Full-Width Buttons**
   ```css
   .btn {
     width: 100%;
   }
   ```

3. **Smaller Video Heights**
   ```css
   .video-element {
     min-height: 250px; /* vs 400px on desktop */
   }
   ```

4. **Reduced Padding**
   ```css
   .broadcast-section {
     padding: 15px; /* vs 20px on desktop */
   }
   ```

5. **Single Column Grid**
   ```css
   .broadcasts-grid {
     grid-template-columns: 1fr; /* One column on mobile */
   }
   ```

---

## Error Handling

### Camera/Microphone Access

```javascript
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  alert('Camera access is not available. On mobile devices, you must use HTTPS.');
  return;
}
```

**Common Issues:**
- HTTP on mobile (requires HTTPS)
- Permissions denied
- Camera in use by another app
- Browser doesn't support getUserMedia

### WebRTC Errors

```javascript
producerTransport.on('connect', async (...params, callback, errback) => {
  try {
    // ... connect logic
    callback(); // Success
  } catch (error) {
    errback(error); // Failure
  }
});
```

### Broadcast End

```javascript
useEffect(() => {
  socket.on('broadcastEnded', ({ roomId }) => {
    if (roomId === viewingRoom) {
      stopViewing();
      alert(`Broadcast ${roomId} has ended`);
    }
  });
  
  return () => socket.off('broadcastEnded');
}, [viewingRoom]);
```

---

## State Management Flow

### Broadcasting State Flow

```
Initial State
  ↓
User enters roomId → roomId state updated
  ↓
User clicks "Start Broadcast"
  ↓
Get user media → localStream state set
  ↓
isBroadcasting set to true → Video element renders
  ↓
useEffect attaches stream to video → Video displays
  ↓
Create transport & produce tracks → Broadcasting
```

### Viewing State Flow

```
Initial State → broadcasts list displayed
  ↓
User clicks "View Broadcast"
  ↓
Join broadcast → Create transport
  ↓
Consume media → remoteStream state set
  ↓
viewingRoom state updated → Viewing UI renders
  ↓
useEffect attaches stream to video → Video plays
```

---

## Network Configuration

### Development vs Production

**Development (Local Network):**
```javascript
const serverUrl = 'http://192.168.1.68:3001';
```

**Production:**
```javascript
const serverUrl = 'https://yourdomain.com';
```

### HTTPS Requirement

Mobile browsers require HTTPS for:
- `getUserMedia` (camera/microphone access)
- WebRTC connections (secure context)

**Vite HTTPS Config:**
```javascript
// vite.config.js
export default defineConfig({
  server: {
    host: '0.0.0.0',  // Listen on all interfaces
    port: 5173,
    https: true       // Enable HTTPS
  }
});
```

---

## Performance Considerations

### Video Quality

Affected by:
- Camera resolution
- Network bandwidth
- CPU power
- Server capacity

### Resource Cleanup

**Critical for preventing memory leaks:**

```javascript
// Stop all tracks
stream.getTracks().forEach(track => track.stop());

// Clear video element
videoElement.srcObject = null;

// Close transports
transport.close();

// Remove event listeners
socket.off('eventName');
```

---

## Complete User Flows

### Broadcaster Journey

```
1. Open app → See "Start Broadcasting" section
2. Enter room ID (e.g., "myroom")
3. Click "Start Broadcast"
4. Browser asks for camera/mic permissions → Grant
5. Local video preview appears (mirrored)
6. Video is being sent to server
7. Other users see "myroom" in broadcast list
8. Click "Stop Broadcast" when done
9. Stream stops, video preview disappears
```

### Viewer Journey

```
1. Open app → See "Active Broadcasts" section
2. List shows available broadcasts (e.g., "myroom")
3. Click "View Broadcast" on "myroom"
4. Remote video loads and plays
5. Watch the broadcast
6. Click "Stop Viewing" to leave
7. Return to broadcast list
```

---

## Component Communication

```
App.jsx (Parent)
  ├── socket (passed as prop)
  ├── device (passed as prop)
  ├── broadcasts (passed as prop)
  │
  ├── BroadcastButton (Child)
  │   └── Uses socket & device to create producers
  │
  └── BroadcastList (Child)
      └── Uses socket, device & broadcasts to create consumers
```

**Props Flow:**
- Parent manages global state
- Children receive props (socket, device, broadcasts)
- Children use props to interact with server
- Server sends updates → Parent updates state → Children re-render

---

## Debug Tools

### Console Logging

The app includes extensive logging:

```javascript
console.log('Got media stream:', stream.getTracks());
console.log('Local video stream set:', tracks);
console.log('Broadcasting started successfully');
console.log('Remote video stream set:', stream.getTracks());
console.log('Viewing broadcast:', roomId);
```

**What to check:**
- Are tracks being created?
- Are tracks enabled?
- Are video elements found?
- Is srcObject being set?

### Browser DevTools

**Check Network Tab:**
- WebSocket connection established?
- Socket.IO events being sent/received?

**Check Console:**
- Any JavaScript errors?
- WebRTC errors?
- Socket.IO connection status?

**Check Media Internals (chrome://webrtc-internals):**
- ICE connection state
- DTLS connection state
- Video/audio statistics
- Packet loss, bitrate, etc.

---

## Best Practices

### 1. Always Clean Up Resources

```javascript
useEffect(() => {
  // Setup
  socket.on('event', handler);
  
  return () => {
    // Cleanup
    socket.off('event', handler);
  };
}, [dependencies]);
```

### 2. Handle Loading States

```javascript
{!device ? (
  <div className="loading">Initializing...</div>
) : (
  <ComponentContent />
)}
```

### 3. User Feedback

```javascript
{isConnected ? (
  <span className="status-connected">🟢 Connected</span>
) : (
  <span className="status-disconnected">🔴 Disconnected</span>
)}
```

### 4. Error Boundaries (Future Enhancement)

```javascript
class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    // Log error, show fallback UI
  }
}
```

---

## Common Issues & Solutions

### Issue: Video not visible to broadcaster

**Cause**: Video element not rendered before stream attached

**Solution**: Set `isBroadcasting` before `setLocalStream`
```javascript
setIsBroadcasting(true);  // Render video element first
setLocalStream(stream);   // Then set stream
```

### Issue: Camera works on PC but not mobile

**Cause**: HTTP on mobile (requires HTTPS)

**Solution**: Enable HTTPS in Vite config
```javascript
server: { https: true }
```

### Issue: Video is backwards/mirrored

**Solution**: Add CSS transform
```css
.video-element {
  transform: scaleX(-1);
}
```

### Issue: Broadcast list not updating

**Cause**: Not listening to `broadcastList` event

**Solution**: Add event listener in App.jsx
```javascript
socket.on('broadcastList', setBroadcasts);
```

---

## Future Enhancements

### Features to Add

1. **Screen Sharing**
   ```javascript
   const stream = await navigator.mediaDevices.getDisplayMedia();
   ```

2. **Chat Feature**
   - Socket.IO message events
   - Chat UI component

3. **Recording**
   - MediaRecorder API
   - Save to server or local download

4. **Quality Settings**
   - Adjust video resolution
   - Change bitrate

5. **Reconnection Logic**
   - Handle network interruptions
   - Auto-reconnect on disconnect

6. **User Authentication**
   - Login system
   - Protected broadcasts

7. **Multiple Cameras**
   - Camera selection dropdown
   - Switch between devices

---

## Dependencies

### Production Dependencies

```json
{
  "react": "^19.2.0",
  "react-dom": "^19.2.0",
  "socket.io-client": "^4.6.1",
  "mediasoup-client": "^3.7.0"
}
```

**Purpose:**
- `react` & `react-dom`: UI framework
- `socket.io-client`: Real-time communication
- `mediasoup-client`: WebRTC client library

### Dev Dependencies

```json
{
  "@vitejs/plugin-react": "^5.1.1",
  "vite": "^7.2.4",
  "eslint": "^9.39.1"
}
```

**Purpose:**
- Build tools and development server
- Code quality and linting

---

## Summary

The frontend application:

1. **Connects** to server via Socket.IO
2. **Initializes** mediasoup Device with server capabilities
3. **Allows broadcasting** by creating producer transport and sending media
4. **Allows viewing** by creating consumer transport and receiving media
5. **Manages state** using React hooks (useState, useEffect, useRef)
6. **Displays video** using video elements with refs
7. **Handles errors** gracefully with user feedback
8. **Supports mobile** with responsive design and HTTPS
9. **Cleans up** resources on unmount and state changes
10. **Provides real-time updates** via Socket.IO events

**Architecture Pattern**: Component-based React application with centralized state management in parent component, props drilling for shared state, and local state in child components for UI-specific concerns.
