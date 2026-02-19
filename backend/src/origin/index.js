import os from 'os';
import { originConfig as config } from './config.js';
import { createApp } from '../utils/createApp.js';
import { getContainerIp } from '../utils/network.js';
import { createWorkers, createWorkerPool } from '../services/mediasoupService.js';
import { RedisClient } from '../services/redisClient.js';
import { registerOriginRoutes } from './routes.js';
import { registerOriginSocketHandlers } from './socketHandlers.js';
import { createLogger } from '../utils/logger.js';
import authRoutes from './authRoutes.js';
import classroomRoutes from './classroomRoutes.js';
import { socketAuthMiddleware } from '../middleware/auth.js';
import prisma from '../services/prisma.js';

const log = createLogger('origin');
const containerIp = getContainerIp();

// Shared State
const broadcasts = new Map(); // roomId → broadcast object
const state = { rtpCapabilities: null, containerIp };

async function start() {
  log.info(`
╔════════════════════════════════════════╗
║     ORIGIN SERVER CONFIGURATION        ║
╚════════════════════════════════════════╝
  Port: ${config.port}
  Workers: ${config.numWorkers} (CPU cores: ${os.cpus().length})
  RTC Ports: ${config.rtcMinPort}–${config.rtcMaxPort}
  Announced IP: ${config.announcedIp}
  Container IP: ${containerIp}
  Redis: ${config.redisUrl}
`);

  // 1. Redis
  const redisClient = new RedisClient();
  await redisClient.connect(config.redisUrl);
  await redisClient.client.set(
    'origin:info',
    JSON.stringify({
      ip: config.announcedIp,
      port: config.port,
      containerIp,
      role: 'ORIGIN',
      registeredAt: Date.now(),
    }),
  );

  // 2. mediasoup
  const { workers, rtpCapabilities } = await createWorkers({
    numWorkers: config.numWorkers,
    logLevel: config.logLevel,
    rtcMinPort: config.rtcMinPort,
    rtcMaxPort: config.rtcMaxPort,
  });
  state.rtpCapabilities = rtpCapabilities;
  const getNextWorker = createWorkerPool(workers);

  // 3. Verify database connection
  try {
    await prisma.$connect();
    log.info('PostgreSQL connected via Prisma');
  } catch (dbErr) {
    log.warn('PostgreSQL not available – auth features disabled:', dbErr.message);
  }

  // 4. Express + Socket.IO
  const { app, httpServer, io } = createApp();

  // Auth & Classroom REST routes
  app.use('/api/auth', authRoutes);
  app.use('/api/classrooms', classroomRoutes);

  registerOriginRoutes({ app, config, redisClient, state });

  // Socket.IO auth middleware
  io.use(socketAuthMiddleware);

  // Redis pub/sub → live viewer count updates
  await redisClient.subscribeToViewerCount((payload) => {
    io.emit('viewerCount', payload);
  });

  registerOriginSocketHandlers({ io, config, redisClient, broadcasts, state, getNextWorker });

  // 5. Listen
  httpServer.listen(config.port, () => {
    log.info(`ORIGIN SERVER running on port ${config.port}`);
    log.info(`  Network: http://${config.announcedIp}:${config.port}`);
    log.info('Ready to receive broadcasts and pipe to Edge servers');
  });

  // 6. Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    broadcasts.forEach((b) => {
      b.producers.forEach((p) => { try { p.close(); } catch (_) {} });
      try { b.router.close(); } catch (_) {}
    });
    workers.forEach((w) => { try { w.close(); } catch (_) {} });
    await prisma.$disconnect();
    await redisClient.disconnect();
    httpServer.close(() => {
      log.info('Origin server stopped');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  log.error('Failed to start Origin server:', err);
  process.exit(1);
});
