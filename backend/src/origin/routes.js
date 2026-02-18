/**
 * Origin REST API routes
 * - /health
 * - /stats
 * - /api/best-server   (load balancer)
 * - /api/all-edges
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('origin:api');

/**
 * @param {object}      deps
 * @param {import('express').Express} deps.app
 * @param {object}      deps.config
 * @param {object}      deps.redisClient
 * @param {object}      deps.state        – shared origin state (broadcasts, rtpCapabilities)
 */
export function registerOriginRoutes({ app, config, redisClient, state }) {
  // Health
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', role: 'ORIGIN' });
  });

  // Stats
  app.get('/stats', async (_req, res) => {
    try {
      const stats = await redisClient.getStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Load Balancer – Best Edge
  app.get('/api/best-server', async (req, res) => {
    try {
      const { roomId } = req.query;
      if (!roomId) return res.status(400).json({ error: 'roomId query parameter required' });

      log.info(`Load balancer query for room: ${roomId}`);

      const broadcast = await redisClient.getBroadcast(roomId);
      if (!broadcast || broadcast.status !== 'active') {
        return res.status(404).json({ error: 'Broadcast not found or not active' });
      }

      const allEdges = await redisClient.getAllEdges();
      if (!allEdges?.length) {
        log.warn('No edge servers registered, falling back to Origin');
        return res.json({
          edgeIp: config.announcedIp,
          edgePort: config.port,
          rtcCapabilities: state.rtpCapabilities,
          isOrigin: true,
          message: 'No edge servers available – connecting to origin',
        });
      }

      const broadcastEdgeIds = broadcast.edgeServers || [];
      const available = allEdges.filter(
        (e) => broadcastEdgeIds.includes(e.serverId) && e.userCount < e.maxCapacity && e.isAlive,
      );

      if (!available.length) {
        log.warn(`No edges have broadcast ${roomId}, falling back to Origin`);
        return res.json({
          edgeIp: config.announcedIp,
          edgePort: config.port,
          rtcCapabilities: state.rtpCapabilities,
          isOrigin: true,
          message: 'No edges available for this broadcast – connecting to origin',
        });
      }

      const best = available.reduce((least, cur) => {
        const lLoad = (least.userCount / least.maxCapacity) * 100;
        const cLoad = (cur.userCount / cur.maxCapacity) * 100;
        return cLoad < lLoad ? cur : least;
      });

      log.info(`Best edge for ${roomId}: ${best.serverId} (${best.ip}:${best.port}) [${best.userCount}/${best.maxCapacity}]`);

      res.json({
        edgeIp: best.ip,
        edgePort: best.port,
        rtcCapabilities: state.rtpCapabilities,
        isOrigin: false,
        load: (best.userCount / best.maxCapacity) * 100,
        maxCapacity: best.maxCapacity,
        currentUsers: best.userCount,
        serverId: best.serverId,
      });
    } catch (err) {
      log.error('Load balancer error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // All Edges
  app.get('/api/all-edges', async (req, res) => {
    try {
      const { roomId } = req.query;
      const broadcast = roomId ? await redisClient.getBroadcast(roomId) : { edgeServers: [] };
      const allEdges = await redisClient.getAllEdges();

      const enriched = allEdges.map((e) => ({
        ...e,
        loadPercentage: (e.userCount / e.maxCapacity) * 100,
        isInBroadcast: !roomId || (broadcast.edgeServers || []).includes(e.serverId),
      }));

      res.json({
        totalEdges: enriched.length,
        activeEdges: enriched.filter((e) => e.isAlive).length,
        edges: enriched,
      });
    } catch (err) {
      log.error('Error fetching edges:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
