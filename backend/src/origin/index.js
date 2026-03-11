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
import edgeRegistryRoutes from './edgeRegistryRoutes.js';
import { socketAuthMiddleware } from '../middleware/auth.js';
import prisma from '../services/prisma.js';
import { EdgeScalingManager } from './edgeScalingManager.js';
import { validateConfig, getConfigSummary } from '../utils/validateConfig.js';

const log = createLogger('origin');
const containerIp = getContainerIp();

// Shared State
const broadcasts = new Map(); // roomId → broadcast object
const state = { rtpCapabilities: null, containerIp };

async function start() {
  // Validate configuration before starting
  try {
    validateConfig();
    log.info('Configuration summary:', getConfigSummary());
  } catch (err) {
    log.error('Configuration validation failed:', err.message);
    process.exit(1);
  }

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

  // Expose redisClient for route handlers via app.locals
  app.locals.redisClient = redisClient;

  // Auth & Classroom REST routes
  app.use('/api/auth', authRoutes);
  app.use('/api/classrooms', classroomRoutes);
  app.use('/api/internal', edgeRegistryRoutes);

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

  // 6. Auto-scaling (optional - AWS only)
  let scaler = null;

  if (config.autoScale.enabled) {
    const { AwsProvider } = await import('./providers/awsProvider.js');
    const provider = new AwsProvider(config.autoScale.aws);

    scaler = new EdgeScalingManager({
      redisClient,
      provider,
      config: config.autoScale,
    });

    // Expose scaler for the API routes
    app.locals.edgeScaler = scaler;

    await scaler.start();
  }

  // 7. Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const activeBroadcasts = broadcasts.size;
    log.info(`Shutting down (${signal}) — ${activeBroadcasts} active broadcast(s) will be terminated`);

    // Stop accepting new connections
    httpServer.close(() => {
      log.info('HTTP server closed');
    });

    // Stop autoscaler
    if (scaler) await scaler.stop();

    // Wait up to 30s for active broadcasts to drain naturally before force-closing
    if (activeBroadcasts > 0) {
      log.info(`Waiting up to 30s for ${activeBroadcasts} broadcast(s) to drain...`);
      await new Promise((resolve) => {
        const deadline = setTimeout(resolve, 30_000);
        const check = setInterval(() => {
          if (broadcasts.size === 0) {
            clearInterval(check);
            clearTimeout(deadline);
            resolve();
          }
        }, 1_000);
      });
      if (broadcasts.size > 0) {
        log.warn(`${broadcasts.size} broadcast(s) still active after drain window, forcing close`);
      } else {
        log.info('All broadcasts drained cleanly');
      }
    }

    // Force-close any remaining broadcasts
    broadcasts.forEach((b) => {
      b.producers.forEach((p) => { try { p.close(); } catch (_) {} });
      try { b.router.close(); } catch (_) {}
    });

    // Cleanup workers
    workers.forEach((w) => { try { w.close(); } catch (_) {} });

    // Disconnect services
    await prisma.$disconnect();
    await redisClient.disconnect();

    log.info('Origin server stopped');
    process.exit(0);
  };

  // Force exit after 35s if graceful shutdown hangs (5s buffer over the 30s drain window)
  const forceExit = (signal) => {
    shutdown(signal);
    setTimeout(() => {
      log.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 35_000).unref();
  };

  process.on('SIGINT', () => forceExit('SIGINT'));
  process.on('SIGTERM', () => forceExit('SIGTERM'));
}

start().catch((err) => {
  log.error('Failed to start Origin server:', err.message || err, err.stack || '');
  process.exit(1);
});
