# BroadClass — Backend Architecture

## Overview

This backend server implements the BroadClass one-to-many broadcast platform using **mediasoup** (WebRTC SFU), **Socket.IO** for real-time communication, and **Express** as the web server. The server acts as a Selective Forwarding Unit (SFU), routing media streams from broadcasters to multiple viewers.

**Architecture**: Each broadcast gets its own dedicated mediasoup router for better isolation and resource management.

---

## Technology Stack

- **Express**: HTTP server framework
- **Socket.IO**: Real-time bidirectional event-based communication
- **mediasoup**: WebRTC SFU for media streaming
- **Node.js**: Runtime environment

---

## Core Concepts

### What is an SFU (Selective Forwarding Unit)?

An SFU is a WebRTC architecture where:
- Broadcasters send their media stream to the server once
- The server forwards that stream to all viewers
- Unlike MCU (Multipoint Control Unit), the SFU doesn't decode/re-encode media
- More efficient for one-to-many streaming

### mediasoup Components

1. **Worker**: A separate process that handles media processing
2. **Router**: Routes media between producers and consumers
3. **Transport**: WebRTC connection for sending/receiving media
4. **Producer**: Sends media (broadcaster's video/audio)
5. **Consumer**: Receives media (viewer's video/audio)

---

## Server Initialization

### 1. Create mediasoup Worker

```javascript
worker = await mediasoup.createWorker({
  logLevel: 'warn',
  rtcMinPort: 10000,
  rtcMaxPort: 10100
});
```

- Worker runs in a separate process
- Handles all media processing
- Uses UDP ports 10000-10100 for RTC communication

### 2. Create Routers (Per Broadcast)

```javascript
// Router created when first client connects to a room
const router = await worker.createRouter({ mediaCodecs });
```

- **One router per broadcast** for better isolation
- Router manages media routing between producers and consumers within that broadcast
- Configured with supported codecs (VP8 for video, Opus for audio)
- Created automatically when first transport is requested for a room
- Closed and cleaned up when broadcast ends

---

## Data Structures

### Broadcasts Map

```javascript
broadcasts = Map {
  'roomId' => {
    roomId: 'room123',
    router: Router,              // Dedicated router for this broadcast
    broadcasterId: 'socket-id',
    producers: Map {
      'video' => Producer,
      'audio' => Producer
    },
    viewers: Set ['socket-id-1', 'socket-id-2']
  }
}
```

Each broadcast contains:
- **roomId**: Unique identifier for the broadcast
- **router**: Dedicated mediasoup router for this broadcast
- **broadcasterId**: Socket ID of the broadcaster
- **producers**: Map of media producers (video and audio)
- **viewers**: Set of viewer socket IDs

---

## Socket.IO Events Flow

### Initial Connection

**Event**: `connection`
- Triggered when a client connects
- Server logs the connection
- Socket is ready to handle events

---

### Broadcasting Flow

#### Step 1: Get Router Capabilities

**Event**: `getRouterRtpCapabilities`

```
Client → Server: getRouterRtpCapabilities()
Server → Client: router.rtpCapabilities
```

- Client needs router's RTP capabilities to initialize its device
- Server creates a temporary router to get capabilities (all routers have same capabilities)
- Temporary router is closed immediately after returning capabilities
- Returns supported codecs and RTP parameters

#### Step 2: Create Producer Transport

**Event**: `createWebRtcTransport` (sender: true, roomId)

```
Client → Server: createWebRtcTransport({ sender: true, roomId })
Server → Client: { id, iceParameters, iceCandidates, dtlsParameters }
```

- Client must provide roomId to identify which broadcast
- **Router creation**: If room doesn't exist, server creates a new router for this broadcast
- Creates a WebRTC transport on the broadcast's router for sending media
- Transport listens on multiple IPs for network flexibility
- Returns ICE/DTLS parameters for WebRTC connection

**listenIps Configuration:**
```javascript
listenIps: [
  { ip: '0.0.0.0', announcedIp: '127.0.0.1' },      // Localhost
  { ip: '0.0.0.0', announcedIp: '192.168.1.68' },   // Local network
  { ip: '0.0.0.0', announcedIp: '10.121.158.190' }  // Additional network
]
```

#### Step 3: Connect Transport

**Event**: `connectTransport`

```
Client → Server: connectTransport({ transportId, dtlsParameters })
Server → Client: { success: true }
```

- Completes the WebRTC handshake
- Establishes the DTLS connection
- Transport is now ready to send/receive media

#### Step 4: Start Broadcasting

**Event**: `startBroadcast`

```
Client → Server: startBroadcast({ roomId, rtpParameters, kind })
Server → Client: { producerId }
Server → All: broadcastList([roomIds...])
```

- Creates a producer for the media track (video or audio)
- Stores producer in the broadcasts map
- Notifies all clients about the new broadcast
- Called twice: once for video, once for audio

**What happens:**
1. Retrieves the broadcast entry (which contains the dedicated router)
2. Producer is created from the transport on that router
3. Broadcaster ID is set on first media track
4. Producer is stored by kind (video/audio)
5. All clients receive updated broadcast list

**Note**: Router must already exist (created during transport creation)

---

### Viewing Flow

#### Step 1: Get Broadcasts

**Event**: `getBroadcasts`

```
Client → Server: getBroadcasts()
Server → Client: [roomIds...]
```

- Returns array of active room IDs
- Called when client wants to see available broadcasts

#### Step 2: Join Broadcast

**Event**: `joinBroadcast`

```
Client → Server: joinBroadcast({ roomId })
Server → Client: { success: true }
```

- Adds viewer's socket ID to the broadcast's viewers set
- Validates that broadcast exists
- Prepares viewer to consume media

#### Step 3: Create Consumer Transport

**Event**: `createWebRtcTransport` (sender: false, roomId)

```
Client → Server: createWebRtcTransport({ sender: false, roomId })
Server → Client: { id, iceParameters, iceCandidates, dtlsParameters }
```

- Client must provide roomId to connect to correct broadcast
- Server uses the broadcast's existing router (created by broadcaster)
- Creates a WebRTC transport on that router for receiving media
- Similar to producer transport but for consuming

#### Step 4: Connect Consumer Transport

**Event**: `connectTransport`

```
Client → Server: connectTransport({ transportId, dtlsParameters })
Server → Client: { success: true }
```

- Connects the consumer transport
- Ready to receive media

#### Step 5: Consume Media

**Event**: `consume`

```
Client → Server: consume({ roomId, rtpCapabilities, kind })
Server → Client: { id, producerId, kind, rtpParameters }
```

- Called twice: once for video, once for audio
- Server checks if client can consume the producer
- Creates a consumer linked to the broadcaster's producer
- Consumer is initially paused, then resumed after 100ms
- Returns RTP parameters needed by client to decode media

**What happens:**
1. Find the broadcast and its producer for the requested kind
2. Check if client's capabilities support the producer (using broadcast's router)
3. Create consumer on the transport (on the same router as the producer)
4. Return consumer details to client
5. Resume consumer after brief delay

**Important**: Consumer and Producer must be on the same router for routing to work

---

### Cleanup Flow

#### Stop Broadcasting

**Event**: `stopBroadcast`

```
Client → Server: stopBroadcast({ roomId })
Server → Viewers: broadcastEnded({ roomId })
Server → All: broadcastList([roomIds...])
```

- Closes all producers
- **Closes the dedicated router** for this broadcast
- Removes broadcast from map
- Notifies viewers that broadcast ended
- Updates broadcast list for all clients

#### Disconnection

**Event**: `disconnect`

```
Client disconnects
Server cleans up resources
```

**Cleanup process:**
1. If broadcaster disconnects:
   - Close all producers
   - **Close the broadcast's router**
   - Remove broadcast from map
   - Notify viewers
   - Update broadcast list

2. If viewer disconnects:
   - Remove from viewers set
   - Close transports

3. Always:
   - Close producer transport
   - Close consumer transport

---

## WebRTC Transport Configuration

### ICE (Interactive Connectivity Establishment)

```javascript
enableUdp: true,
enableTcp: true,
preferUdp: true
```

- Tries UDP first (better for real-time media)
- Falls back to TCP if UDP is blocked
- Handles NAT traversal

### Multiple Network Interfaces

The server announces multiple IPs to support:
- **127.0.0.1**: Local development (same machine)
- **192.168.1.68**: Local network access (WiFi)
- **10.121.158.190**: Additional network interface

This allows clients to connect from different network contexts.

---

## Media Codecs Configuration

### Video: VP8

```javascript
{
  kind: 'video',
  mimeType: 'video/VP8',
  clockRate: 90000,
  parameters: {
    'x-google-start-bitrate': 1000
  }
}
```

- **VP8**: Widely supported, royalty-free codec
- **Clock rate**: 90kHz (standard for video)
- **Start bitrate**: 1000 kbps

### Audio: Opus

```javascript
{
  kind: 'audio',
  mimeType: 'audio/opus',
  clockRate: 48000,
  channels: 2
}
```

- **Opus**: High-quality, low-latency audio codec
- **Clock rate**: 48kHz (high quality)
- **Channels**: Stereo (2 channels)

---

## Complete Flow Diagram

```
BROADCASTER                    SERVER                         VIEWER
    |                            |                               |
    |-- getRouterRtpCapabilities->|                               |
    |<- rtpCapabilities ----------|                               |
    |                            |                               |
    |-- createWebRtcTransport -->|                               |
    |   (sender: true)           |                               |
    |<- transport params ---------|                               |
    |                            |                               |
    |-- connectTransport -------->|                               |
    |<- success ------------------|                               |
    |                            |                               |
    |-- startBroadcast (video) -->|                               |
    |<- producerId ---------------|                               |
    |                            |                               |
    |-- startBroadcast (audio) -->|                               |
    |<- producerId ---------------|                               |
    |                            |-- broadcastList ------------->|
    |                            |                               |
    |                            |                               |
    |                            |<- getBroadcasts --------------|
    |                            |-- [roomIds] ----------------->|
    |                            |                               |
    |                            |<- joinBroadcast --------------|
    |                            |-- success ------------------->|
    |                            |                               |
    |                            |<- createWebRtcTransport ------|
    |                            |   (sender: false)             |
    |                            |-- transport params ---------->|
    |                            |                               |
    |                            |<- connectTransport -----------|
    |                            |-- success ------------------->|
    |                            |                               |
    |                            |<- consume (video) ------------|
    |                            |-- consumer params ----------->|
    |                            |                               |
    |                            |<- consume (audio) ------------|
    |                            |-- consumer params ----------->|
    |                            |                               |
    |   MEDIA FLOWS ------------------------------------------>  |
    |                            |                               |
```

---

## Error Handling

### Transport Creation Errors
- Logged to console
- Error message sent to client
- Client should retry or notify user

### Producer/Consumer Creation Errors
- Validation checks before creation
- Error callbacks to client
- Resources cleaned up automatically

### Disconnection Handling
- Automatic cleanup of all resources
- Viewers notified when broadcaster disconnects
- Prevents memory leaks and zombie connections

---

## Port Configuration

- **HTTP Server**: 3001
- **WebRTC (UDP/TCP)**: 10000-10100
- All ports must be open in firewall for external access

---

## Security Considerations

### CORS
```javascript
cors: {
  origin: '*',
  methods: ['GET', 'POST']
}
```

- Currently allows all origins (development)
- Should be restricted in production to specific domains

### Transport Security
- Uses DTLS for secure media transport
- ICE authentication prevents unauthorized connections

---

## Performance Characteristics

### Scalability
- One worker per server instance
- **One router per broadcast** (better isolation)
- Each worker can handle multiple routers simultaneously
- Current limitation: All routers run on same worker (single CPU core)
- Recommended: Implement multi-worker architecture for high-scale deployments

### Resource Usage
- **Broadcaster**: 1 transport, 2 producers (video + audio)
- **Viewer**: 1 transport, 2 consumers (video + audio)
- Memory scales linearly with number of broadcasts and viewers

---

## Architecture Benefits

### One Router Per Broadcast

**Advantages:**
✅ **Better Isolation** - Each broadcast operates independently
✅ **Independent Quality** - One busy broadcast doesn't affect others
✅ **Easier Debugging** - Can track which router handles which broadcast
✅ **Resource Management** - Routers are freed when broadcasts end
✅ **Prevents Interference** - Media routing is isolated per broadcast

**Current Limitation:**
⚠️ All routers still run on single worker (one CPU core)

**Capacity Estimates:**
- **Per broadcast**: ~50-100 viewers (depends on quality/bandwidth)
- **Multiple broadcasts**: Limited by total CPU capacity
- **Upgrade path**: Multi-worker architecture for horizontal scaling

### When to Scale Further

Consider multi-worker architecture when:
- Supporting 100+ concurrent viewers across multiple broadcasts
- CPU usage consistently above 70%
- Need to scale beyond single server capabilities
- Require high-availability setup

---

## Debugging

### Logs
- Worker creation
- Router creation
- Client connections/disconnections
- Broadcast start/stop
- Transport/Producer/Consumer creation

### Common Issues

1. **No video/audio**: Check codec support in client
2. **Connection fails**: Verify firewall and announced IPs
3. **Poor quality**: Check network bandwidth and CPU usage
4. **Disconnection loops**: Check transport closure on errors

---

## Production Recommendations

1. **Use proper SSL certificates** for HTTPS/WSS
2. **Restrict CORS** to known domains
3. **Add authentication** for Socket.IO connections
4. **Monitor worker health** and restart if needed
5. **Use process managers** (PM2) for automatic restarts
6. **Configure announced IPs** for your public IP/domain
7. **Add rate limiting** to prevent abuse
8. **Implement reconnection logic** on clients
9. **Add recording capabilities** if needed
10. **Monitor bandwidth usage** per broadcast

---

## Summary

The backend server:
1. Creates mediasoup worker on startup (routers created on-demand)
2. Accepts Socket.IO connections from clients
3. **Creates a dedicated router for each broadcast** when first transport is requested
4. Creates WebRTC transports for sending/receiving media on the appropriate router
5. Manages producers (broadcasters) and consumers (viewers) per router
6. Routes media from one broadcaster to many viewers within isolated routers
7. Handles cleanup on disconnection (including closing routers)
8. Maintains broadcast state in memory with router references

**Key Architecture Decision**: One router per broadcast provides better isolation and resource management, though all routers currently run on a single worker process.

This architecture efficiently supports multiple one-to-many broadcasts with better isolation than a shared router approach, while still forwarding packets without transcoding.
