import { edgeConfig as config } from './config.js';
import { createApp } from '../utils/createApp.js';
import { getContainerIp } from '../utils/network.js';
import { createWorkers } from '../services/mediasoupService.js';
import { mediaCodecs } from '../config/mediaCodecs.js';
import { RedisClient } from '../services/redisClient.js';
import { registerEdgeRoutes } from './routes.js';
import { registerEdgeSocketHandlers } from './socketHandlers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('edge');
const containerIp = getContainerIp();

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
  log.info(`
╔════════════════════════════════════════╗
║      EDGE SERVER CONFIGURATION         ║
╚════════════════════════════════════════╝
  Server ID: ${config.serverId}
  Internal: ${config.internalHost}:${config.port}
  External: ${config.announcedIp}:${config.externalPort}
  Container IP: ${containerIp}
  Max Capacity: ${config.maxCapacity} students
  RTC Ports: ${config.rtcMinPort}–${config.rtcMaxPort}
  Redis: ${config.redisUrl}
`);

  // 1. Redis
  const redisClient = new RedisClient();
  await redisClient.connect(config.redisUrl);
  await redisClient.registerEdge({
    ip: config.announcedIp,
    port: config.externalPort,
    serverId: config.serverId,
    internalHost: config.internalHost,
    internalPort: config.port,
    maxCapacity: config.maxCapacity,
    region: config.region,
  });

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
  registerEdgeSocketHandlers({ io, config, edgeState });

  // 4. Listen
  httpServer.listen(config.port, () => {
    log.info(`EDGE SERVER ${config.serverId} running on port ${config.port}`);
    log.info(`  External: http://${config.announcedIp}:${config.externalPort}`);
    log.info(`Ready to serve ${config.maxCapacity} students`);
  });

  // 5. Health heartbeats
  const healthInterval = setInterval(async () => {
    try {
      await redisClient.updateEdgeHeartbeat(config.serverId, edgeState.connectedStudents);
      const load = ((edgeState.connectedStudents / config.maxCapacity) * 100).toFixed(1);
      log.debug(`Heartbeat – Students: ${edgeState.connectedStudents}/${config.maxCapacity} (${load}%)`);
    } catch (err) {
      log.error('Heartbeat error:', err);
    }
  }, config.healthCheckInterval);

  // 6. Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    clearInterval(healthInterval);

    edgeState.broadcasts.forEach((b) => {
      b.virtualProducers.forEach((p) => { try { p.close(); } catch (_) {} });
      try { b.pipeTransport?.close(); } catch (_) {}
    });

    try { edgeState.mainRouter?.close(); } catch (_) {}
    workers.forEach((w) => { try { w.close(); } catch (_) {} });

    await redisClient.removeEdge(config.serverId);
    await redisClient.disconnect();

    httpServer.close(() => {
      log.info('Edge server stopped');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  log.error('Failed to start Edge server:', err);
  process.exit(1);
});
