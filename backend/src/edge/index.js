import { edgeConfig as config } from './config.js';
import { createApp } from '../utils/createApp.js';
import { getContainerIp } from '../utils/network.js';
import { createWorkers } from '../services/mediasoupService.js';
import { mediaCodecs } from '../config/mediaCodecs.js';
import { RedisClient } from '../services/redisClient.js';
import { registerEdgeRoutes } from './routes.js';
import { registerEdgeSocketHandlers } from './socketHandlers.js';
import { createLogger } from '../utils/logger.js';
import { socketAuthMiddleware } from '../middleware/auth.js';
import { getCpuUsage, getMemoryUsage } from '../utils/systemMetrics.js';
import { validateConfig, getConfigSummary } from '../utils/validateConfig.js';

const log = createLogger('edge');
const containerIp = getContainerIp();

const ORIGIN_URL = `http://${config.originIp}:${config.originPort}`;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'broadclass-internal-key-change-in-production';

// Shared Edge State
const edgeState = {
  mainRouter: null,
  rtpCapabilities: null,
  broadcasts: new Map(),   // roomId → { pipeTransport, virtualProducers }
  connectedStudents: 0,
  containerIp,
  io: null,                // set after createApp
};

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
║      EDGE SERVER CONFIGURATION         ║
╚════════════════════════════════════════╝
  Port: ${config.port}
╚════════════════════════════════════════╝
  Server ID: ${config.serverId}
  Internal: ${config.internalHost}:${config.port}
  External: ${config.announcedIp}:${config.externalPort}
  Container IP: ${containerIp}
  Max Capacity: ${config.maxCapacity} students
  RTC Ports: ${config.rtcMinPort}–${config.rtcMaxPort}
  Redis: ${config.redisUrl}
`);

  // 1. Redis (still needed for broadcast viewer counts & pub/sub)
  const redisClient = new RedisClient();
  await redisClient.connect(config.redisUrl);

  // 1b. Self-register with Origin via HTTP API
  async function registerWithOrigin() {
    try {
      const res = await fetch(`${ORIGIN_URL}/api/internal/register-edge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          serverId: config.serverId,
          ip: config.announcedIp,
          port: config.externalPort,
          internalHost: config.internalHost,
          internalPort: config.port,
          maxCapacity: config.maxCapacity,
          region: config.region,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Origin responded ${res.status}: ${text}`);
      }
      log.info(`Registered with Origin at ${ORIGIN_URL}`);
    } catch (err) {
      log.error(`Failed to register with Origin: ${err.message}`);
      // Also register directly in Redis as fallback
      await redisClient.registerEdge({
        ip: config.announcedIp,
        port: config.externalPort,
        serverId: config.serverId,
        internalHost: config.internalHost,
        internalPort: config.port,
        maxCapacity: config.maxCapacity,
        region: config.region,
      });
      log.info('Fell back to direct Redis registration');
    }
  }

  await registerWithOrigin();

  // 2. mediasoup – create workers + main router
  const { workers } = await createWorkers({
    numWorkers: config.numWorkers,
    logLevel: config.logLevel,
    rtcMinPort: config.rtcMinPort,
    rtcMaxPort: config.rtcMaxPort,
  });

  edgeState.mainRouter = await workers[0].createRouter({ mediaCodecs });
  edgeState.rtpCapabilities = edgeState.mainRouter.rtpCapabilities;

  // 3. Express + Socket.IO
  const { app, httpServer, io } = createApp();
  edgeState.io = io;

  registerEdgeRoutes({ app, config, edgeState });

  // Socket.IO auth middleware
  io.use(socketAuthMiddleware);

  registerEdgeSocketHandlers({ io, config, edgeState, redisClient });

  // 4. Listen
  httpServer.listen(config.port, () => {
    log.info(`EDGE SERVER ${config.serverId} running on port ${config.port}`);
    log.info(`  External: http://${config.announcedIp}:${config.externalPort}`);
    log.info(`Ready to serve ${config.maxCapacity} students`);
  });

  // 5. Health heartbeats via Origin HTTP API
  const healthInterval = setInterval(async () => {
    try {
      const cpuUsage = await getCpuUsage();
      const memoryUsage = getMemoryUsage();

      const res = await fetch(`${ORIGIN_URL}/api/internal/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          serverId: config.serverId,
          userCount: edgeState.connectedStudents,
          cpuUsage,
          memoryUsage,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.reRegister) {
          log.warn('Origin says re-register — edge TTL expired. Re-registering...');
          await registerWithOrigin();
        } else {
          throw new Error(`Origin responded ${res.status}`);
        }
      }

      const load = ((edgeState.connectedStudents / config.maxCapacity) * 100).toFixed(1);
      log.debug(`Heartbeat – Students: ${edgeState.connectedStudents}/${config.maxCapacity} (${load}%) CPU: ${cpuUsage.toFixed(1)}%`);
    } catch (err) {
      log.error('Heartbeat error:', err.message);
      // Fallback: write directly to Redis
      try {
        await redisClient.updateEdgeHeartbeat(config.serverId, edgeState.connectedStudents);
      } catch (_) { /* Redis also unavailable */ }
    }
  }, config.healthCheckInterval);

  // 6. Graceful shutdown
  let isShuttingDown = false;
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info(`Shutting down (${signal})...`);
    clearInterval(healthInterval);

    // Deregister from Origin via HTTP
    try {
      await fetch(`${ORIGIN_URL}/api/internal/deregister-edge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_API_KEY,
        },
        body: JSON.stringify({ serverId: config.serverId }),
      });
      log.info('Deregistered from Origin');
    } catch (err) {
      log.warn('Could not deregister from Origin:', err.message);
    }

    // Close mediasoup resources
    edgeState.broadcasts.forEach((b) => {
      b.virtualProducers.forEach((p) => { try { p.close(); } catch (_) {} });
      try { b.pipeTransport?.close(); } catch (_) {}
    });

    try { edgeState.mainRouter?.close(); } catch (_) {}
    workers.forEach((w) => { try { w.close(); } catch (_) {} });

    // Cleanup Redis
    await redisClient.removeEdge(config.serverId);
    await redisClient.disconnect();

    httpServer.close(() => {
      log.info('Edge server stopped');
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      log.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  log.error('Failed to start Edge server:', err.message || err, err.stack || '');
  process.exit(1);
});
