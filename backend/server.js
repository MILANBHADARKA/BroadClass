const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store active broadcasts
const broadcasts = new Map();
let worker;

// Mediasoup configuration
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  }
];

// Initialize mediasoup worker and router
async function initMediasoup() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 10000,
    rtcMaxPort: 10100
  });

  console.log('Mediasoup worker created');

  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting...');
    process.exit(1);
  });

  console.log('Mediasoup worker ready');
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Get router RTP capabilities for client initialization
  socket.on('getRouterRtpCapabilities', async (callback) => {
    // Create a temporary router just to get capabilities (all routers have same capabilities)
    const tempRouter = await worker.createRouter({ mediaCodecs });
    callback(tempRouter.rtpCapabilities);
    tempRouter.close();
  });

  // Create WebRTC transport for sending or receiving media
  socket.on('createWebRtcTransport', async ({ sender, roomId }, callback) => {
    try {
      // Get or create broadcast to access its router
      let broadcast = broadcasts.get(roomId);

      // If this is a producer (sender), check if room already has a broadcaster
      if (sender && broadcast && broadcast.broadcasterId && broadcast.broadcasterId !== socket.id) {
        return callback({ error: `Room "${roomId}" is already being used by another broadcaster. Please choose a different room ID.` });
      }
      
      // If broadcast doesn't exist yet, create it with a new router
      if (!broadcast) {
        const router = await worker.createRouter({ mediaCodecs });
        broadcast = {
          roomId,
          router,
          broadcasterId: null, // Will be set on startBroadcast
          producers: new Map(),
          viewers: new Set()
        };
        broadcasts.set(roomId, broadcast);
        console.log(`Router created for room: ${roomId}`);
      }

      const transport = await broadcast.router.createWebRtcTransport({
        listenIps: [
          {
            ip: '0.0.0.0',
            announcedIp: '127.0.0.1'
          },
          {
            ip: '0.0.0.0',
            announcedIp: '192.168.1.68'
          },
        //   {
        //     ip: '0.0.0.0',
        //     announcedIp: '10.121.158.190'
        //   }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      });

      // Store transport reference
      if (sender) {
        socket.producerTransport = transport;
      } else {
        socket.consumerTransport = transport;
      }

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      callback({ error: error.message });
    }
  });

  // Connect transport after client-side setup
  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      const transport = socket.producerTransport?.id === transportId 
        ? socket.producerTransport 
        : socket.consumerTransport;
      
      await transport.connect({ dtlsParameters });
      callback({ success: true });
    } catch (error) {
      console.error('Error connecting transport:', error);
      callback({ error: error.message });
    }
  });

  // Create a new broadcast
  socket.on('startBroadcast', async ({ roomId, rtpParameters, kind }, callback) => {
    try {
      // Get broadcast (should already exist from createWebRtcTransport)
      const broadcast = broadcasts.get(roomId);
      if (!broadcast) {
        return callback({ error: 'Broadcast not initialized. Create transport first.' });
      }

      // Prevent multiple broadcasters in the same room
      if (broadcast.broadcasterId && broadcast.broadcasterId !== socket.id) {
        return callback({ error: `Room "${roomId}" is already being used by another broadcaster.` });
      }

      // Set broadcaster ID on first media track
      if (!broadcast.broadcasterId) {
        broadcast.broadcasterId = socket.id;
        console.log(`Broadcaster ${socket.id} claimed room: ${roomId}`);
      }

      // Create producer for the broadcaster
      const producer = await socket.producerTransport.produce({
        kind,
        rtpParameters
      });

      broadcast.producers.set(kind, producer);

      console.log(`Broadcast started: ${roomId}, kind: ${kind}, router: ${broadcast.router.id}`);

      // Notify all clients about new broadcast
      io.emit('broadcastList', Array.from(broadcasts.keys()));

      callback({ producerId: producer.id });
    } catch (error) {
      console.error('Error starting broadcast:', error);
      callback({ error: error.message });
    }
  });

  // Get list of active broadcasts
  socket.on('getBroadcasts', (callback) => {
    callback(Array.from(broadcasts.keys()));
  });

  // Join a broadcast as a viewer
  socket.on('joinBroadcast', async ({ roomId }, callback) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast) {
        return callback({ error: 'Broadcast not found' });
      }

      broadcast.viewers.add(socket.id);
      socket.currentRoom = roomId;

      console.log(`Viewer ${socket.id} joined broadcast ${roomId}`);
      callback({ success: true });
    } catch (error) {
      console.error('Error joining broadcast:', error);
      callback({ error: error.message });
    }
  });

  // Consume media from a broadcast
  socket.on('consume', async ({ roomId, rtpCapabilities, kind }, callback) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast || !broadcast.producers.has(kind)) {
        return callback({ error: 'Producer not found' });
      }

      const producer = broadcast.producers.get(kind);

      // Check if client can consume this producer (use broadcast's router)
      if (!broadcast.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        return callback({ error: 'Cannot consume' });
      }

      // Create consumer
      const consumer = await socket.consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true
      });

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });

      // Resume consumer after a brief delay
      setTimeout(async () => {
        await consumer.resume();
      }, 100);

    } catch (error) {
      console.error('Error consuming:', error);
      callback({ error: error.message });
    }
  });

  // Stop broadcasting
  socket.on('stopBroadcast', ({ roomId }) => {
    const broadcast = broadcasts.get(roomId);
    if (broadcast && broadcast.broadcasterId === socket.id) {
      // Close all producers
      broadcast.producers.forEach(producer => producer.close());
      
      // Close the router
      broadcast.router.close();
      
      broadcasts.delete(roomId);

      console.log(`Broadcast stopped and router closed: ${roomId}`);

      // Notify viewers and update broadcast list
      io.to(roomId).emit('broadcastEnded', { roomId });
      io.emit('broadcastList', Array.from(broadcasts.keys()));
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Clean up broadcasts if broadcaster disconnected
    broadcasts.forEach((broadcast, roomId) => {
      if (broadcast.broadcasterId === socket.id) {
        broadcast.producers.forEach(producer => producer.close());
        broadcast.router.close(); // Close the router
        broadcasts.delete(roomId);
        io.emit('broadcastList', Array.from(broadcasts.keys()));
        io.to(roomId).emit('broadcastEnded', { roomId });
        console.log(`Router closed for disconnected broadcaster: ${roomId}`);
      } else {
        broadcast.viewers.delete(socket.id);
      }
    });

    // Close transports
    if (socket.producerTransport) socket.producerTransport.close();
    if (socket.consumerTransport) socket.consumerTransport.close();
  });
});

const PORT = process.env.PORT || 3001;

// Start server after initializing mediasoup
initMediasoup().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access via http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error('Failed to initialize mediasoup:', error);
  process.exit(1);
});
