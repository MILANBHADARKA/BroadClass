/**
 * Edge REST API routes
 * - /health
 * - /stats
 * - /api/pipe-setup    (called by Origin)
 * - /api/pipe-produce  (called by Origin)
 * - /api/pipe-cleanup  (called by Origin)
 */

import { createLogger } from '../utils/logger.js';
import { getMemoryUsage, getProcessMemory } from '../utils/systemMetrics.js';

const log = createLogger('edge:api');

/**
 * @param {object}  deps
 * @param {import('express').Express} deps.app
 * @param {object}  deps.config
 * @param {object}  deps.edgeState – { mainRouter, broadcasts, connectedStudents, containerIp, io }
 */
export function registerEdgeRoutes({ app, config, edgeState }) {
  // Internal API key verification for pipe endpoints
  const verifyInternalKey = (req, res, next) => {
    const key = req.headers['x-internal-key'];
    if (key !== config.internalApiKey) {
      return res.status(403).json({ error: 'Forbidden: invalid internal API key' });
    }
    next();
  };

  // Liveness probe - simple check that process is alive (no dependencies)
  app.get('/health/live', (_req, res) => {
    res.status(200).json({
      status: 'alive',
      role: 'EDGE',
      serverId: config.serverId,
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
  });

  // Readiness/Health probe - detailed check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      role: 'EDGE',
      serverId: config.serverId,
      connectedStudents: edgeState.connectedStudents,
      maxCapacity: config.maxCapacity,
      loadPercentage: ((edgeState.connectedStudents / config.maxCapacity) * 100).toFixed(2),
      activeBroadcasts: edgeState.broadcasts.size,
      uptime: Math.round(process.uptime()),
      memory: getProcessMemory(),
      systemMemory: getMemoryUsage(),
      region: config.region,
      timestamp: Date.now(),
    });
  });

  // Stats
  app.get('/stats', (_req, res) => {
    res.json({
      edge: {
        serverId: config.serverId,
        connectedStudents: edgeState.connectedStudents,
        maxCapacity: config.maxCapacity,
        loadPercentage: ((edgeState.connectedStudents / config.maxCapacity) * 100).toFixed(2),
      },
      broadcasts: Array.from(edgeState.broadcasts.entries()).map(([roomId, b]) => ({
        roomId,
        producers: Array.from(b.virtualProducers.keys()),
        hasPipe: !!b.pipeTransport,
      })),
      uptime: process.uptime(),
    });
  });

  // Pipe Setup (called by Origin)
  app.post('/api/pipe-setup', verifyInternalKey, async (req, res) => {
    try {
      const { roomId, originPipeIp, originPipePort, originSrtpParameters } = req.body;
      log.info(`Pipe setup for room: ${roomId} (origin ${originPipeIp}:${originPipePort})`);

      const pipeTransport = await edgeState.mainRouter.createPipeTransport({
        listenInfo: { protocol: 'udp', ip: '0.0.0.0', announcedIp: edgeState.containerIp },
        enableSrtp: true,
        enableSctp: false,
        enableRtx: false,
      });

      await pipeTransport.connect({
        ip: originPipeIp,
        port: originPipePort,
        srtpParameters: originSrtpParameters,
      });

      log.info(`  Edge pipe connected to Origin`);

      // Store or replace pipe transport for this room
      if (!edgeState.broadcasts.has(roomId)) {
        edgeState.broadcasts.set(roomId, {
          pipeTransport,
          virtualProducers: new Map(),
          connectedAt: Date.now(),
        });
      } else {
        const broadcast = edgeState.broadcasts.get(roomId);
        try { broadcast.pipeTransport?.close(); } catch (_) {}
        broadcast.pipeTransport = pipeTransport;
      }

      res.json({
        success: true,
        edgePipeIp: edgeState.containerIp,
        edgePipePort: pipeTransport.tuple.localPort,
        edgeSrtpParameters: pipeTransport.srtpParameters,
      });
    } catch (err) {
      log.error('Error in pipe-setup:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Pipe Produce (called by Origin)
  app.post('/api/pipe-produce', verifyInternalKey, async (req, res) => {
    try {
      const { roomId, producers } = req.body;
      log.info(`Pipe produce for room: ${roomId} (${producers.length} producer(s))`);

      const broadcast = edgeState.broadcasts.get(roomId);
      if (!broadcast?.pipeTransport) {
        return res.status(400).json({ error: 'No pipe transport for this room' });
      }

      const created = [];

      for (const { consumerId, kind, rtpParameters } of producers) {
        const pipeProducer = await broadcast.pipeTransport.produce({
          id: consumerId,
          kind,
          rtpParameters,
        });

        broadcast.virtualProducers.set(kind, pipeProducer);

        pipeProducer.on('transportclose', () => {
          log.info(`Virtual ${kind} producer transport closed for ${roomId}`);
          broadcast.virtualProducers.delete(kind);
        });

        created.push({ kind, producerId: pipeProducer.id });
        log.info(`  Virtual ${kind} producer created: ${pipeProducer.id}`);
      }

      log.info(`Room ${roomId} ready to serve students on ${config.serverId}`);
      res.json({ success: true, producers: created });
    } catch (err) {
      log.error('Error in pipe-produce:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Pipe Cleanup (called by Origin)
  app.post('/api/pipe-cleanup', verifyInternalKey, (req, res) => {
    try {
      const { roomId } = req.body;
      log.info(`Cleaning up broadcast ${roomId}`);

      const broadcast = edgeState.broadcasts.get(roomId);
      if (broadcast) {
        broadcast.virtualProducers.forEach((p) => { try { p.close(); } catch (_) {} });
        try { broadcast.pipeTransport?.close(); } catch (_) {}
        edgeState.broadcasts.delete(roomId);
        edgeState.io.emit('broadcastEnded', { roomId });
      }

      res.json({ success: true });
    } catch (err) {
      log.error('Error in pipe-cleanup:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
