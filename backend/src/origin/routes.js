/**
 * Origin REST API routes
 * - /health
 * - /stats
 * - /api/best-server   (load balancer)
 * - /api/all-edges
 */

import { createLogger } from '../utils/logger.js';
import { verifyToken } from '../middleware/auth.js';
import { bestServerRateLimiter } from '../middleware/rateLimiter.js';
import prisma from '../services/prisma.js';
import { getCpuUsage, getMemoryUsage, getProcessMemory } from '../utils/systemMetrics.js';

const log = createLogger('origin:api');

/**
 * @param {object}      deps
 * @param {import('express').Express} deps.app
 * @param {object}      deps.config
 * @param {object}      deps.redisClient
 * @param {object}      deps.state        – shared origin state (broadcasts, rtpCapabilities)
 */
export function registerOriginRoutes({ app, config, redisClient, state }) {
  // Liveness probe - simple check that process is alive (no dependencies)
  app.get('/health/live', (_req, res) => {
    res.status(200).json({
      status: 'alive',
      role: 'ORIGIN',
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
  });

  // Readiness/Health probe - detailed check with dependencies
  app.get('/health', async (_req, res) => {
    try {
      const edges = await redisClient.getAllEdges();
      const broadcasts = await redisClient.getAllBroadcasts();
      res.json({
        status: 'healthy',
        role: 'ORIGIN',
        uptime: Math.round(process.uptime()),
        memory: getProcessMemory(),
        systemMemory: getMemoryUsage(),
        edges: edges.length,
        activeBroadcasts: broadcasts.length,
        totalViewers: broadcasts.reduce((s, b) => s + (b.viewerCount || 0), 0),
        timestamp: Date.now(),
      });
    } catch {
      res.json({ status: 'healthy', role: 'ORIGIN', uptime: Math.round(process.uptime()) });
    }
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

  // Load Balancer – Best Edge (protected)
  app.get('/api/best-server', bestServerRateLimiter, verifyToken, async (req, res) => {
    try {
      const { roomId } = req.query;
      if (!roomId) return res.status(400).json({ error: 'roomId query parameter required' });

      log.info(`Load balancer query for room: ${roomId}`);

      // Verify enrollment for students. Fail closed on DB errors — otherwise a
      // transient outage would let any authenticated student pull edge URLs
      // for any classroom they're not enrolled in.
      if (req.user.role === 'STUDENT') {
        try {
          const enrollment = await prisma.enrollment.findUnique({
            where: {
              classroomId_studentId: {
                classroomId: roomId,
                studentId: req.user.id,
              },
            },
          });
          if (!enrollment) {
            return res.status(403).json({ error: 'Not enrolled in this classroom' });
          }
        } catch (dbErr) {
          log.error('DB enrollment check failed:', dbErr.message);
          return res.status(503).json({ error: 'Enrollment check temporarily unavailable, please retry' });
        }
      }

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
