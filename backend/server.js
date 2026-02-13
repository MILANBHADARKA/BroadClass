import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import * as mediasoup from 'mediasoup';
import os from 'os';

const app = express();
const server = createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

/**
 * Configuration from environment variables
 */
const config = {
  port: process.env.PORT || 3001,
  announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
  rtcMinPort: parseInt(process.env.RTC_MIN_PORT) || 40000,
  rtcMaxPort: parseInt(process.env.RTC_MAX_PORT) || 49999,
  numWorkers: parseInt(process.env.NUM_WORKERS) || os.cpus().length,
  logLevel: process.env.LOG_LEVEL || 'warn',
  enableSimulcast: process.env.ENABLE_SIMULCAST === 'true',
  maxProducersPerRoom: parseInt(process.env.MAX_PRODUCERS_PER_ROOM) || 2,
  maxConsumersPerRoom: parseInt(process.env.MAX_CONSUMERS_PER_ROOM) || 1000,
  maxViewersPerBroadcast: parseInt(process.env.MAX_VIEWERS_PER_BROADCAST) || 500
};

console.log('Server Configuration:');
console.log(`   Workers: ${config.numWorkers} (CPU cores: ${os.cpus().length})`);
console.log(`   RTC Ports: ${config.rtcMinPort}-${config.rtcMaxPort} (${config.rtcMaxPort - config.rtcMinPort + 1} ports)`);
console.log(`   Announced IP: ${config.announcedIp}`);
console.log(`   Simulcast: ${config.enableSimulcast ? 'Enabled' : 'Disabled'}`);

/**
 * Worker pool for load balancing across CPU cores
 */
const workers = [];
let nextWorkerIdx = 0;

/**
 * Cached RTP capabilities (same for all routers)
 * Avoids creating temporary routers
 */
let cachedRouterCapabilities = null;

/**
 * Store active broadcasts
 * Structure: Map {
 *   roomId => {
 *     roomId, router, broadcasterId, 
 *     producers: Map { kind => producer },
 *     viewers: Map { socketId => { socketId, consumers: Map { kind => consumer } } }
 *   }
 * }
 */
const broadcasts = new Map();

/**
 * Track socket resources for cleanup
 * Map { socketId => { producerTransport, consumerTransport, producers: [], consumers: [] } }
 */
const socketResources = new Map();

/**
 * mediasoup supported codecs with optimal settings
 */
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
  },
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: {
      'profile-id': 2,
      'x-google-start-bitrate': 1000
    }
  },
  {
    kind: 'video',
    mimeType: 'video/h264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000
    }
  }
];

/**
 * Get next worker from pool (round-robin load balancing)
 */
function getNextWorker() {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

/**
 * Initialize mediasoup workers (one per CPU core)
 */
async function initMediasoup() {
  console.log(`\nInitializing ${config.numWorkers} mediasoup workers...`);
  
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.logLevel,
      rtcMinPort: config.rtcMinPort,
      rtcMaxPort: config.rtcMaxPort
    });

    worker.on('died', () => {
      console.error(`❌ Worker ${i} died! PID: ${worker.pid}`);
      // In production, you might want to respawn the worker
      process.exit(1);
    });

    workers.push(worker);
    console.log(`   ✅ Worker ${i} created - PID: ${worker.pid}`);
  }

  // Create a temporary router to cache RTP capabilities
  const tempRouter = await workers[0].createRouter({ mediaCodecs });
  cachedRouterCapabilities = tempRouter.rtpCapabilities;
  tempRouter.close();
  
  console.log('✅ Router RTP capabilities cached');
  console.log(`✅ Mediasoup initialization complete\n`);
}

/**
 * Socket.IO connection handling
 */
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Initialize socket resources tracking
  socketResources.set(socket.id, {
    producerTransport: null,
    consumerTransport: null,
    producers: [],
    consumers: []
  });

  /**
   * Get router RTP capabilities (cached, no router creation)
   */
  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(cachedRouterCapabilities);
  });

  /**
   * Create WebRTC transport for sending or receiving media
   */
  socket.on('createWebRtcTransport', async ({ sender, roomId }, callback) => {
    try {
      let broadcast = broadcasts.get(roomId);

      // Validation: Check if room has broadcaster and this is another producer
      if (sender && broadcast && broadcast.broadcasterId && broadcast.broadcasterId !== socket.id) {
        return callback({ 
          error: `Room "${roomId}" is already in use. Choose a different room ID.` 
        });
      }
      
      // Create broadcast entry if doesn't exist
      if (!broadcast) {
        // Get worker from pool for load balancing
        const worker = getNextWorker();
        const router = await worker.createRouter({ mediaCodecs });
        
        broadcast = {
          roomId,
          router,
          broadcasterId: null,
          producers: new Map(),
          viewers: new Map(),
          createdAt: Date.now()
        };
        broadcasts.set(roomId, broadcast);
        console.log(`📺 Room created: ${roomId} (Worker PID: ${worker.pid})`);
      }

      // Check viewer limit
      if (!sender && broadcast.viewers.size >= config.maxViewersPerBroadcast) {
        return callback({ 
          error: `Room is full (max ${config.maxViewersPerBroadcast} viewers)` 
        });
      }

      // Create WebRTC transport
      const transport = await broadcast.router.createWebRtcTransport({
        listenIps: [
          {
            ip: '0.0.0.0',
            announcedIp: config.announcedIp
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
        minimumAvailableOutgoingBitrate: 600000,
        maxSctpMessageSize: 262144,
        maxIncomingBitrate: 1500000
      });

      // Store transport reference
      const resources = socketResources.get(socket.id);
      if (sender) {
        resources.producerTransport = transport;
      } else {
        resources.consumerTransport = transport;
      }

      // Monitor transport stats (optional, for debugging)
      if (config.logLevel === 'debug') {
        setInterval(async () => {
          const stats = await transport.getStats();
          console.log(`Transport ${transport.id} stats:`, stats);
        }, 10000);
      }

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });

    } catch (error) {
      console.error('❌ Error creating transport:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Connect transport
   */
  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      const resources = socketResources.get(socket.id);
      const transport = resources.producerTransport?.id === transportId 
        ? resources.producerTransport 
        : resources.consumerTransport;
      
      if (!transport) {
        return callback({ error: 'Transport not found' });
      }

      await transport.connect({ dtlsParameters });
      callback({ success: true });
      
    } catch (error) {
      console.error('❌ Error connecting transport:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Start broadcast - create producer
   */
  socket.on('startBroadcast', async ({ roomId, rtpParameters, kind }, callback) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast) {
        return callback({ error: 'Broadcast not initialized' });
      }

      // Set broadcaster ID on first producer
      if (!broadcast.broadcasterId) {
        broadcast.broadcasterId = socket.id;
        console.log(`Broadcaster ${socket.id} claimed room: ${roomId}`);
      }

      // Prevent multiple broadcasters
      if (broadcast.broadcasterId !== socket.id) {
        return callback({ error: 'Room already has a broadcaster' });
      }

      // Check producer limit
      if (broadcast.producers.size >= config.maxProducersPerRoom) {
        return callback({ error: 'Maximum producers reached' });
      }

      const resources = socketResources.get(socket.id);
      if (!resources.producerTransport) {
        return callback({ error: 'Producer transport not found' });
      }

      // Create producer (client sends encodings for simulcast)
      const producer = await resources.producerTransport.produce({
        kind,
        rtpParameters
      });

      // Log if simulcast detected
      if (kind === 'video' && producer.type === 'simulcast') {
        console.log('Simulcast producer created with multiple encodings');
      }

      // Store producer
      broadcast.producers.set(kind, producer);
      resources.producers.push(producer);

      // Monitor producer stats
      producer.on('transportclose', () => {
        console.log(`Producer transport closed: ${producer.id}`);
      });

      producer.observer.on('close', () => {
        console.log(`Producer closed: ${producer.id}`);
      });

      console.log(`✅ Producer created - Room: ${roomId}, Kind: ${kind}, ID: ${producer.id}`);

      // Notify all clients about new broadcast with full info
      const broadcastList = Array.from(broadcasts.keys()).map(id => {
        const b = broadcasts.get(id);
        return {
          roomId: id,
          viewerCount: b.viewers.size,
          hasVideo: b.producers.has('video'),
          hasAudio: b.producers.has('audio')
        };
      });
      io.emit('broadcastList', broadcastList);

      callback({ producerId: producer.id });

    } catch (error) {
      console.error('❌ Error starting broadcast:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Get list of active broadcasts
   */
  socket.on('getBroadcasts', (callback) => {
    const broadcastList = Array.from(broadcasts.keys()).map(roomId => {
      const broadcast = broadcasts.get(roomId);
      return {
        roomId,
        viewerCount: broadcast.viewers.size,
        hasVideo: broadcast.producers.has('video'),
        hasAudio: broadcast.producers.has('audio')
      };
    });
    callback(broadcastList);
  });

  /**
   * Join broadcast as viewer
   */
  socket.on('joinBroadcast', async ({ roomId }, callback) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast) {
        return callback({ error: 'Broadcast not found' });
      }

      // Check viewer limit
      if (broadcast.viewers.size >= config.maxViewersPerBroadcast) {
        return callback({ error: 'Broadcast is full' });
      }

      // Add viewer
      broadcast.viewers.set(socket.id, {
        socketId: socket.id,
        consumers: new Map(),
        joinedAt: Date.now()
      });
      
      socket.currentRoom = roomId;
      console.log(`Viewer ${socket.id} joined room ${roomId} (${broadcast.viewers.size} viewers)`);
      
      callback({ success: true });

    } catch (error) {
      console.error('❌ Error joining broadcast:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Consume media from broadcast
   */
  socket.on('consume', async ({ roomId, rtpCapabilities, kind }, callback) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast || !broadcast.producers.has(kind)) {
        return callback({ error: 'Producer not found' });
      }

      const producer = broadcast.producers.get(kind);
      const resources = socketResources.get(socket.id);

      if (!resources.consumerTransport) {
        return callback({ error: 'Consumer transport not found' });
      }

      // Check if can consume
      if (!broadcast.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
        return callback({ error: 'Cannot consume this producer' });
      }

      // Create consumer
      const consumer = await resources.consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true
      });

      // Store consumer reference for cleanup
      resources.consumers.push(consumer);
      
      const viewer = broadcast.viewers.get(socket.id);
      if (viewer) {
        viewer.consumers.set(kind, consumer);
      }

      // Enable adaptive layer selection for video with simulcast
      if (config.enableSimulcast && kind === 'video' && consumer.type === 'simulcast') {
        // Start with medium quality (layer 1), will auto-adapt based on network
        await consumer.setPreferredLayers({
          spatialLayer: 1,   // 0=low, 1=medium, 2=high
          temporalLayer: 2   // Max temporal layer
        });
        console.log(`Simulcast layers enabled - Starting with medium quality`);
        
        // Auto-adapt based on score (network quality indicator)
        consumer.on('score', ({ score }) => {
          // Score ranges from 0-10 per layer
          // Auto-adjust quality based on network conditions
          if (score[0]?.score < 5 && score[0]?.score > 0) {
            // Poor network - switch to low quality
            consumer.setPreferredLayers({ spatialLayer: 0, temporalLayer: 2 })
              .then(() => console.log(`Auto-switched to LOW quality (score: ${score[0]?.score})`));
          } else if (score[0]?.score >= 7) {
            // Good network - switch to high quality
            consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 })
              .then(() => console.log(`Auto-switched to HIGH quality (score: ${score[0]?.score})`));
          } else if (score[0]?.score >= 5) {
            // Medium network - switch to medium quality
            consumer.setPreferredLayers({ spatialLayer: 1, temporalLayer: 2 })
              .then(() => console.log(`Auto-switched to MEDIUM quality (score: ${score[0]?.score})`));
          }
        });
      }

      // Monitor consumer
      consumer.on('transportclose', () => {
        console.log(`Consumer transport closed: ${consumer.id}`);
      });

      consumer.on('producerclose', () => {
        console.log(`Producer closed for consumer: ${consumer.id}`);
        socket.emit('producerClosed', { kind });
      });

      consumer.on('layerschange', (layers) => {
        console.log(`Layer changed - Spatial: ${layers?.spatialLayer}, Temporal: ${layers?.temporalLayer}`);
        // Notify client about quality change
        socket.emit('qualityChanged', { 
          kind, 
          spatialLayer: layers?.spatialLayer,
          quality: layers?.spatialLayer === 0 ? 'low' : layers?.spatialLayer === 1 ? 'medium' : 'high'
        });
      });

      consumer.observer.on('close', () => {
        console.log(`Consumer closed: ${consumer.id}`);
      });

      console.log(`✅ Consumer created - Room: ${roomId}, Kind: ${kind}, ID: ${consumer.id}`);

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        simulcast: config.enableSimulcast && kind === 'video' && consumer.type === 'simulcast'
      });

      // Resume consumer
      setTimeout(async () => {
        await consumer.resume();
      }, 100);

    } catch (error) {
      console.error('❌ Error consuming:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Set preferred quality layer (manual quality control)
   */
  socket.on('setQuality', async ({ roomId, quality }, callback) => {
    try {
      const resources = socketResources.get(socket.id);
      const viewer = broadcasts.get(roomId)?.viewers.get(socket.id);
      
      if (!viewer) {
        return callback({ error: 'Not viewing this broadcast' });
      }

      const videoConsumer = viewer.consumers.get('video');
      if (!videoConsumer || videoConsumer.type !== 'simulcast') {
        return callback({ error: 'Simulcast not available' });
      }

      // Map quality string to spatial layer
      const layerMap = {
        'low': 0,
        'medium': 1,
        'high': 2,
        'auto': null  // Will use automatic adaptation
      };

      const spatialLayer = layerMap[quality];
      
      if (spatialLayer === null) {
        // Auto mode - let network conditions decide
        callback({ success: true, mode: 'auto' });
        return;
      }

      if (spatialLayer === undefined) {
        return callback({ error: 'Invalid quality. Use: low, medium, high, or auto' });
      }

      await videoConsumer.setPreferredLayers({
        spatialLayer,
        temporalLayer: 2
      });

      console.log(`Manual quality set: ${quality} (layer ${spatialLayer}) for viewer ${socket.id}`);
      callback({ success: true, quality, spatialLayer });

    } catch (error) {
      console.error('❌ Error setting quality:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Get current consumer stats and quality info
   */
  socket.on('getConsumerStats', async ({ roomId }, callback) => {
    try {
      const viewer = broadcasts.get(roomId)?.viewers.get(socket.id);
      if (!viewer) {
        return callback({ error: 'Not viewing this broadcast' });
      }

      const stats = {};
      for (const [kind, consumer] of viewer.consumers.entries()) {
        const consumerStats = await consumer.getStats();
        stats[kind] = {
          type: consumer.type,
          paused: consumer.paused,
          currentLayers: consumer.currentLayers,
          preferredLayers: consumer.preferredLayers,
          stats: consumerStats
        };
      }

      callback(stats);

    } catch (error) {
      console.error('❌ Error getting consumer stats:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Get broadcast stats (for monitoring/debugging)
   */
  socket.on('getBroadcastStats', async ({ roomId }, callback) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast) {
        return callback({ error: 'Broadcast not found' });
      }

      const stats = {
        roomId,
        viewerCount: broadcast.viewers.size,
        producerCount: broadcast.producers.size,
        uptime: Date.now() - broadcast.createdAt
      };

      // Get producer stats
      const producerStats = {};
      for (const [kind, producer] of broadcast.producers.entries()) {
        producerStats[kind] = await producer.getStats();
      }
      stats.producers = producerStats;

      callback(stats);

    } catch (error) {
      console.error('❌ Error getting stats:', error);
      callback({ error: error.message });
    }
  });

  /**
   * Leave broadcast as viewer
   */
  socket.on('leaveBroadcast', ({ roomId }) => {
    try {
      const broadcast = broadcasts.get(roomId);
      if (!broadcast) return;

      const viewer = broadcast.viewers.get(socket.id);
      if (viewer) {
        // Close viewer's consumers
        viewer.consumers.forEach(consumer => {
          try {
            consumer.close();
          } catch (e) {
            console.error('Error closing consumer:', e);
          }
        });
        broadcast.viewers.delete(socket.id);
        console.log(`👋 Viewer left: ${roomId} (${broadcast.viewers.size} viewers)`);
        
        // Update broadcast list with new viewer count
        const broadcastList = Array.from(broadcasts.keys()).map(id => {
          const b = broadcasts.get(id);
          return {
            roomId: id,
            viewerCount: b.viewers.size,
            hasVideo: b.producers.has('video'),
            hasAudio: b.producers.has('audio')
          };
        });
        io.emit('broadcastList', broadcastList);
      }
    } catch (error) {
      console.error('❌ Error leaving broadcast:', error);
    }
  });

  /**
   * Stop broadcast
   */
  socket.on('stopBroadcast', ({ roomId }) => {
    cleanupBroadcast(roomId, socket.id);
  });

  /**
   * Handle disconnection
   */
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Clean up broadcasts if broadcaster disconnected
    broadcasts.forEach((broadcast, roomId) => {
      if (broadcast.broadcasterId === socket.id) {
        cleanupBroadcast(roomId, socket.id);
      } else {
        // Remove viewer
        const viewer = broadcast.viewers.get(socket.id);
        if (viewer) {
          // Close viewer's consumers
          viewer.consumers.forEach(consumer => {
            consumer.close();
          });
          broadcast.viewers.delete(socket.id);
          console.log(`👋 Viewer left: ${roomId} (${broadcast.viewers.size} viewers)`);
        }
      }
    });

    // Clean up socket resources
    cleanupSocketResources(socket.id);
  });
});

/**
 * Cleanup broadcast and notify viewers
 */
function cleanupBroadcast(roomId, broadcasterId) {
  const broadcast = broadcasts.get(roomId);
  if (!broadcast || broadcast.broadcasterId !== broadcasterId) {
    return;
  }

  console.log(`Cleaning up broadcast: ${roomId}`);

  // Close all producers
  broadcast.producers.forEach(producer => {
    try {
      producer.close();
    } catch (e) {
      console.error('Error closing producer:', e);
    }
  });

  // Close all consumers for all viewers
  broadcast.viewers.forEach(viewer => {
    viewer.consumers.forEach(consumer => {
      try {
        consumer.close();
      } catch (e) {
        console.error('Error closing consumer:', e);
      }
    });
  });

  // Close router
  try {
    broadcast.router.close();
  } catch (e) {
    console.error('Error closing router:', e);
  }

  // Remove from broadcasts
  broadcasts.delete(roomId);

  console.log(`✅ Broadcast cleaned up: ${roomId}`);

  // Notify viewers
  io.to(roomId).emit('broadcastEnded', { roomId });
  
  // Update broadcast list with full info
  const broadcastList = Array.from(broadcasts.keys()).map(id => {
    const b = broadcasts.get(id);
    return {
      roomId: id,
      viewerCount: b.viewers.size,
      hasVideo: b.producers.has('video'),
      hasAudio: b.producers.has('audio')
    };
  });
  io.emit('broadcastList', broadcastList);
}

/**
 * Cleanup socket resources
 */
function cleanupSocketResources(socketId) {
  const resources = socketResources.get(socketId);
  if (!resources) return;

  console.log(`Cleaning up resources for socket: ${socketId}`);

  // Close all producers
  resources.producers.forEach(producer => {
    try {
      if (!producer.closed) producer.close();
    } catch (e) {
      console.error('Error closing producer:', e);
    }
  });

  // Close all consumers
  resources.consumers.forEach(consumer => {
    try {
      if (!consumer.closed) consumer.close();
    } catch (e) {
      console.error('Error closing consumer:', e);
    }
  });

  // Close transports
  if (resources.producerTransport) {
    try {
      resources.producerTransport.close();
    } catch (e) {
      console.error('Error closing producer transport:', e);
    }
  }

  if (resources.consumerTransport) {
    try {
      resources.consumerTransport.close();
    } catch (e) {
      console.error('Error closing consumer transport:', e);
    }
  }

  socketResources.delete(socketId);
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n Shutting down gracefully...');
  
  // Close all broadcasts
  broadcasts.forEach((broadcast, roomId) => {
    cleanupBroadcast(roomId, broadcast.broadcasterId);
  });

  // Close all workers
  workers.forEach(worker => {
    worker.close();
  });

  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

/**
 * Start server
 */
initMediasoup().then(() => {
  server.listen(config.port, () => {
    console.log(`\n Server running on port ${config.port}`);
    console.log(`   Local: http://localhost:${config.port}`);
    console.log(`   Network: http://${config.announcedIp}:${config.port}`);
    console.log(`\nReady to handle ${config.numWorkers}x concurrent broadcasts\n`);
  });
}).catch(error => {
  console.error('❌ Failed to initialize mediasoup:', error);
  process.exit(1);
});
