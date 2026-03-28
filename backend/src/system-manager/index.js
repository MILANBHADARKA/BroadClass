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
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import prisma from '../services/prisma.js';
import { RedisClient } from '../services/redisClient.js';
import { createLogger } from '../utils/logger.js';
import { managerConfig } from './config.js';
import authRoutes from './authRoutes.js';
import classroomRoutes from './classroomRoutes.js';
import broadcastRoutes from './broadcastRoutes.js';
import recordingRoutes from './recordingRoutes.js';
import { registerSocketHandlers } from './socketHandlers.js';
import S3RecordingService from '../services/s3Service.js';

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
});
app.use('/api/', limiter);

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

    // Register Socket.IO handlers (pass redisClient for pub/sub)
    const socketManager = registerSocketHandlers(io, redisClient);

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
          await s3Service.cleanup();
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
