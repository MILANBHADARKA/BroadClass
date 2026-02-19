# MediaRooms

A scalable one-to-many live classroom broadcast platform using mediasoup, Socket.IO, Express, and React. Built with modern **ES Modules (ESM)** and production-grade architecture.

## Features
- 🎥 Start a broadcast with camera and microphone
- 📋 View list of active broadcasts
- 👁️ Watch any active broadcast in real-time
- 🎛️ Camera/mic on/off controls during broadcast
- 📊 Adaptive video quality (Simulcast)
- ⚡ Multi-worker architecture (scales with CPU cores)
- 🔧 Production-ready with proper resource management
- 🌐 Modern ES Modules syntax throughout

## Setup Instructions

### Backend Setup
1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```
   
   Server will run on `http://localhost:3001`

### Frontend Setup
1. Navigate to frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   
   Frontend will run on `http://localhost:5173`

## Usage

1. Open the frontend in your browser
2. Enter a Room ID and click "Start Broadcast" to begin broadcasting
3. Your camera and microphone will be activated
4. Other users can see your broadcast in the "Active Broadcasts" list
5. Click "View Broadcast" on any active broadcast to watch it
6. Click "Stop Broadcast" to end your broadcast

## Technology Stack

### Backend
- **Express**: Web server framework
- **Socket.IO**: Real-time bidirectional communication
- **mediasoup**: WebRTC SFU for media streaming

### Frontend
- **React**: UI framework
- **Vite**: Build tool and dev server
- **Socket.IO Client**: Real-time communication with backend
- **mediasoup-client**: WebRTC client for media handling

## Architecture

- **Broadcaster**: Uses producer transport to send audio/video to server
- **Viewers**: Use consumer transport to receive audio/video from server
- **Server**: Acts as SFU (Selective Forwarding Unit) routing media streams
- **Rooms**: Each broadcast has a unique room ID for isolation

## Notes

- Make sure to allow camera and microphone permissions in your browser
- For production, update the `announcedIp` in server.js to your actual server IP
- The system uses VP8 for video and Opus for audio codecs
