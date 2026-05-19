/**
 * System-Manager Server
 *
 * Central management service for BroadClass:
 * - User authentication (register, login, logout, me)
 * - Classroom management (CRUD, enrollment)
 * - Smart edge routing (best-edge API)
 * - Real-time broadcast updates via Socket.IO + Redis pub/sub
 * - Recording metadata API (future)
 * */

import express from 'express';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import prisma from '../services/prisma.js';
import { RedisClient } from '../services/redisClient.js';
import { createLogger } from '../utils/logger.js';
import { managerConfig } from './config.js';
import { socketAuthMiddleware } from '../middleware/auth.js';
import { apiRateLimiter } from '../middleware/rateLimiter.js';
import authRoutes from './authRoutes.js';
import classroomRoutes from './classroomRoutes.js';
import broadcastRoutes from './broadcastRoutes.js';
import recordingRoutes from './recordingRoutes.js';
import chatRoutes from './chatRoutes.js';
import { registerSocketHandlers } from './socketHandlers.js';
import { registerChatSocketHandlers } from './chatSocketHandlers.js';
import S3RecordingService from '../services/s3Service.js';
import { startRecordingJanitor } from './recordingJanitor.js';
import { startSmartChatJanitor } from './smartChatJanitor.js';

const log = createLogger('system-manager');

const app = express();
const httpServer = createServer(app);

/**
 * Socket.IO with CORS for frontend
 */
const io = new Server(httpServer, {
  cors: {
    origin: managerConfig.frontendOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

/**
 * Middleware
 */
app.use(helmet());
app.use(
  cors({
    origin: managerConfig.frontendOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting — uses the shared apiRateLimiter which:
//  - returns JSON on 429 (so res.json() in the client doesn't blow up),
//  - allows 1000 req/min/IP (room for legitimate active sessions),
//  - honors DISABLE_RATE_LIMIT=true in dev.
app.use('/api/', apiRateLimiter);

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'system-manager' });
});

/**
 * API Routes
 */
app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api', broadcastRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/chat', chatRoutes);

/**
 * 404 handler
 */
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/**
 * Error handler
 */
app.use((err, _req, res, _next) => {
  log.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Start server
 */
async function start() {
  try {
    // 1. Test database connection
    log.info('Testing database connection...');
    await prisma.$queryRaw`SELECT 1`;
    log.info('✅ Database connected');

    // 2. Connect Redis
    log.info('Testing Redis connection...');
    const redisClient = new RedisClient();
    await redisClient.connect(managerConfig.redisUrl);
    log.info('✅ Redis connected');

    // 3. Initialize S3 Recording Service (optional - for recording URLs)
    let s3Service = null;
    try {
      s3Service = new S3RecordingService({
        region: process.env.S3_REGION || 'us-east-1',
        bucket: process.env.S3_BUCKET || 'broadclass',
        prefix: process.env.S3_PREFIX || 'recordings',
      });
      if (s3Service.client) {
        log.info('✅ S3 Service initialized');
      } else {
        log.warn('⚠️ S3 Service running without credentials (recording downloads disabled)');
      }
    } catch (err) {
      log.warn('⚠️ S3 Service initialization failed (non-critical):', err.message);
    }

    // 4. Expose services globally for route handlers
    app.locals.redisClient = redisClient;
    app.locals.s3Service = s3Service;

    // Socket.IO Redis adapter — required for multi-instance fan-out. With
    // a single replica it's a no-op, but wiring it now means horizontal
    // scaling is just a `replicas: N` change in compose later.
    try {
      const pubClient = redisClient.client.duplicate();
      const subClient = redisClient.client.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      log.info('✅ Socket.IO Redis adapter attached');
    } catch (err) {
      log.warn('Socket.IO Redis adapter failed — running single-instance only:', err.message);
    }

    // Socket.IO auth — chat events require an authenticated user
    // (socket.user populated from JWT in handshake/cookie).
    io.use(socketAuthMiddleware);

    // Register Socket.IO handlers (pass redisClient for pub/sub)
    const socketManager = registerSocketHandlers(io, redisClient);
    const chatSocketManager = registerChatSocketHandlers({ io, redisClient });

    // Start janitor that reaps recordings stuck in PROCESSING.
    const janitor = startRecordingJanitor();
    // Smart Chat retention — deletes old chat + transcript rows.
    const smartChatJanitor = startSmartChatJanitor();

    // Listen
    httpServer.listen(managerConfig.port, () => {
      log.info(`🚀 System-Manager running on port ${managerConfig.port}`);
      log.info(`   Environment: ${managerConfig.nodeEnv}`);
      log.info(`   Frontend CORS: ${managerConfig.frontendOrigin}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      log.info('SIGTERM received, shutting down...');
      httpServer.close(async () => {
        try {
          janitor.stop();
          smartChatJanitor.stop();
          await chatSocketManager?.shutdown();
          await socketManager?.shutdown();
          await s3Service?.cleanup();
          await redisClient.disconnect();
          await prisma.$disconnect();
          log.info('Shutdown complete');
        } catch (err) {
          log.error('Shutdown error:', err);
        }
        process.exit(0);
      });
    });
  } catch (err) {
    log.error('Failed to start:', err);
    process.exit(1);
  }
}

start();

export default app;
