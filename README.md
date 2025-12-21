# Video Call Application

A scalable video calling application built with WebRTC, WebSocket, and SFU (Selective Forwarding Unit) architecture using mediasoup. This application allows instructors to create rooms and students to join them for live video sessions with chat functionality.

## Features

✨ **Core Features:**
- 📹 Real-time video calling with WebRTC
- 🎤 Audio streaming with echo cancellation
- 💬 Live chat functionality
- 👨‍🏫 Instructor-led sessions
- 👥 Multiple participants support
- 🎛️ Toggle video/audio controls
- 🚀 Scalable SFU architecture with mediasoup

## Technology Stack

### Backend
- **Node.js** - Runtime environment
- **Express** - HTTP server
- **WebSocket (ws)** - Real-time signaling
- **mediasoup** - SFU media server (WebRTC)
- **UUID** - Unique ID generation

### Frontend
- **Vanilla JavaScript** - Client-side logic
- **mediasoup-client** - WebRTC client library
- **Vite** - Build tool and dev server
- **HTML5/CSS3** - UI/UX

## Architecture

```
┌─────────────┐         WebSocket         ┌─────────────┐
│   Client    │◄──────────────────────────►│   Server    │
│  (Browser)  │                            │             │
└─────────────┘                            └─────────────┘
      │                                           │
      │                                           │
      │         WebRTC Media (SFU)                │
      │◄──────────────────────────────────────────┤
      │                                           │
      │                                    ┌──────▼──────┐
      │                                    │  mediasoup  │
      │                                    │   Router    │
      │                                    └─────────────┘
      │
      ▼
  ┌────────────────┐
  │  Video/Audio   │
  │    Streams     │
  └────────────────┘
```

## Prerequisites

Before running this application, make sure you have:

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- Modern browser with WebRTC support (Chrome, Firefox, Safari, Edge)

## Installation

1. **Clone or navigate to the project directory:**
```bash
cd Name-Pending
```

2. **Install server dependencies:**
```bash
npm install
```

3. **Install client dependencies:**
```bash
cd client
npm install
cd ..
```

4. **Configure environment variables:**
The `.env` file is already created with default values:
```env
PORT=3000
WS_PORT=3001
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
MIN_PORT=40000
MAX_PORT=49999
```

For production, update `MEDIASOUP_ANNOUNCED_IP` to your server's public IP address.

## Running the Application

### Development Mode (Recommended for local testing)

Run both server and client concurrently:
```bash
npm run dev
```

Or run them separately:

**Terminal 1 - Server:**
```bash
npm run dev:server
```

**Terminal 2 - Client:**
```bash
npm run dev:client
```

### Production Mode

1. **Build the client:**
```bash
npm run build:client
```

2. **Start the server:**
```bash
npm start
```

## Usage

### For Instructors:

1. Open your browser and navigate to `http://localhost:5173`
2. Enter your name
3. Click **"Create Room (Instructor)"**
4. You'll see your video and a Room ID
5. Share the Room ID with students

### For Students:

1. Open your browser and navigate to `http://localhost:5173`
2. Enter your name
3. Enter the Room ID provided by the instructor
4. Click **"Join Room (Student)"**
5. You'll see the instructor's video and can participate in chat

### Controls:

- 📹 **Video Toggle** - Turn camera on/off
- 🎤 **Audio Toggle** - Mute/unmute microphone
- 💬 **Chat** - Send messages to all participants
- 🚪 **Leave Room** - Exit the video call

## Project Structure

```
Name-Pending/
├── server/
│   ├── index.js           # Main server entry point
│   ├── config.js          # Server configuration
│   ├── mediasoup.js       # Mediasoup initialization
│   ├── roomManager.js     # Room and participant management
│   └── websocket.js       # WebSocket signaling server
├── client/
│   ├── index.html         # Main HTML file
│   ├── styles.css         # Application styles
│   ├── main.js            # Application logic
│   ├── webrtc.js          # WebRTC client wrapper
│   ├── package.json       # Client dependencies
│   └── vite.config.js     # Vite configuration
├── package.json           # Server dependencies
├── .env                   # Environment variables
└── README.md              # This file
```

## Key Components

### Server-side:

1. **mediasoup.js** - Initializes the mediasoup worker and router for handling WebRTC media
2. **roomManager.js** - Manages rooms, participants, and media producers/consumers
3. **websocket.js** - Handles WebSocket signaling for room management and WebRTC negotiation
4. **config.js** - Configuration for mediasoup codecs and network settings

### Client-side:

1. **webrtc.js** - WebRTC client wrapper that handles:
   - Device initialization
   - Transport creation
   - Producer/Consumer management
   - Media stream handling

2. **main.js** - UI logic and event handlers:
   - Room creation/joining
   - Video rendering
   - Chat functionality
   - Media controls

## Firewall Configuration

For production deployment, ensure these ports are open:

- **TCP 3000** - HTTP/WebSocket server
- **UDP/TCP 40000-49999** - WebRTC media (configurable in .env)

## Browser Compatibility

| Browser | Version | Support |
|---------|---------|---------|
| Chrome  | 74+     | ✅ Full |
| Firefox | 66+     | ✅ Full |
| Safari  | 12.1+   | ✅ Full |
| Edge    | 79+     | ✅ Full |

## Troubleshooting

### Camera/Microphone not working:
- Check browser permissions
- Ensure HTTPS in production (required for getUserMedia)
- Try a different browser

### Cannot connect to server:
- Verify server is running on port 3000
- Check firewall settings
- Ensure correct WebSocket URL in client

### No video/audio from other participants:
- Check network connectivity
- Verify firewall allows UDP ports 40000-49999
- Check browser console for errors

### High CPU usage:
- Reduce video resolution in `webrtc.js`
- Limit number of participants
- Use VP8 codec instead of H.264

## Performance Optimization

For better performance:

1. **Reduce video resolution** in `client/webrtc.js`:
```javascript
video: {
  width: { ideal: 640 },   // Reduced from 1280
  height: { ideal: 480 },  // Reduced from 720
}
```

2. **Adjust bitrate** in `server/config.js`:
```javascript
initialAvailableOutgoingBitrate: 600000,  // Reduced from 1000000
```

3. **Deploy close to users** - Use a CDN or edge server

## Security Considerations

⚠️ **Important for Production:**

1. **Use HTTPS** - Required for getUserMedia API
2. **Implement authentication** - Add user authentication system
3. **Rate limiting** - Prevent abuse of room creation
4. **TURN server** - Add TURN server for NAT traversal
5. **Secure WebSocket** - Use WSS instead of WS
6. **Validate inputs** - Sanitize all user inputs

## Scaling

For production-scale deployments:

1. **Multiple mediasoup workers** - Distribute load across CPU cores
2. **Redis** - Store room state across multiple servers
3. **Load balancer** - Distribute WebSocket connections
4. **Horizontal scaling** - Run multiple server instances
5. **TURN/STUN servers** - For better NAT traversal

## Future Enhancements

Potential features to add:

- [ ] Screen sharing
- [ ] Recording functionality
- [ ] Waiting room for students
- [ ] Hand raise feature
- [ ] Polls and quizzes
- [ ] Breakout rooms
- [ ] Virtual backgrounds
- [ ] File sharing
- [ ] Whiteboard
- [ ] User authentication

## License

MIT License - Feel free to use this project for learning and development.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review browser console for errors
3. Check mediasoup documentation: https://mediasoup.org/documentation/

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

---

Built with ❤️ using WebRTC, mediasoup, and modern JavaScript
