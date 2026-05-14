/**
 * Broadcast Routes (System-Manager)
 *
 * GET    /api/best-edge?roomId=XXX     – Smart edge selection (for students watching)
 * GET    /api/classrooms/:id/broadcasts – List active broadcasts in classroom
 * POST   /api/broadcasts/:id/stop       – Stop recording (future: teacher action)
 */
import { Router } from 'express';
import prisma from '../services/prisma.js';
import { verifyToken, verifyRole } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('broadcast:routes');
const router = Router();

/**
 * GET /api/best-edge?roomId=XXX
 * Smart routing: Find the best edge server for a student to watch from
 * Returns: { edgeIp, edgePort, roomId, serverId, isOrigin, load } or error
 * Uses Redis for broadcast and edge data (same as Origin)
 */
router.get('/best-edge', verifyToken, async (req, res) => {
  log.debug(`📝 [MANAGER] GET /api/best-edge?roomId=${req.query.roomId} - user: ${req.user.email}`);
  try {
    const { roomId } = req.query;
    if (!roomId) {
      return res.status(400).json({ error: 'roomId is required' });
    }

    // Get redisClient from app.locals (set in index.js)
    const redisClient = req.app.locals.redisClient;
    if (!redisClient) {
      log.error('redisClient not found in app.locals');
      return res.status(500).json({ error: 'Service unavailable' });
    }

    // Verify user is enrolled in this classroom (if student). Fail closed on
    // DB errors — otherwise a transient outage would let any authenticated
    // student pull edge URLs for any classroom they're not enrolled in.
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

    // Get broadcast from Redis (broadcasts are stored there, not in Prisma)
    const broadcast = await redisClient.getBroadcast(roomId);
    if (!broadcast || broadcast.status !== 'active') {
      return res.status(404).json({ error: 'Broadcast not found or not active' });
    }

    // Get all available edge servers
    const allEdges = await redisClient.getAllEdges();
    if (!allEdges?.length) {
      log.warn('No edge servers registered, returning Origin');
      return res.json({
        edgeIp: process.env.ANNOUNCED_IP || '127.0.0.1',
        edgePort: 3001,
        isOrigin: true,
        message: 'No edge servers available – streaming from origin',
      });
    }

    // Filter edges that have this broadcast and are healthy
    const broadcastEdgeIds = broadcast.edgeServers || [];
    const available = allEdges.filter(
      (e) => broadcastEdgeIds.includes(e.serverId) && e.userCount < e.maxCapacity && e.isAlive,
    );

    if (!available.length) {
      log.warn(`No healthy edges for broadcast ${roomId}, returning Origin`);
      return res.json({
        edgeIp: process.env.ANNOUNCED_IP || '127.0.0.1',
        edgePort: 3001,
        isOrigin: true,
        message: 'No edges available for this broadcast – streaming from origin',
      });
    }

    // Select edge with least load
    const best = available.reduce((least, cur) => {
      const lLoad = (least.userCount / least.maxCapacity) * 100;
      const cLoad = (cur.userCount / cur.maxCapacity) * 100;
      return cLoad < lLoad ? cur : least;
    });

    const loadPercent = (best.userCount / best.maxCapacity) * 100;
    log.info(`✅ [SYSTEM-MANAGER] Best-edge assigned via SYSTEM-MANAGER for ${roomId}: ${best.serverId} (${best.ip}:${best.port}, load: ${loadPercent.toFixed(1)}%) to ${req.user.email}`);
    
    res.json({
      edgeIp: best.ip,
      edgePort: best.port,
      roomId,
      serverId: best.serverId,
      isOrigin: false,
      load: loadPercent,
      maxCapacity: best.maxCapacity,
      currentUsers: best.userCount,
    });
  } catch (err) {
    log.error('Best-edge error:', err);
    res.status(500).json({ error: 'Failed to find edge server' });
  }
});

/**
 * GET /api/classrooms/:classroomId/broadcasts
 * List all active broadcasts in a classroom
 * Returns: { broadcasts: [{ roomId, teacherId, startedAt, viewerCount, edgeServerId }] }
 */
router.get('/classrooms/:classroomId/broadcasts', verifyToken, async (req, res) => {
  try {
    // Verify access to classroom
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.classroomId },
    });

    if (!classroom) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    const isOwner = classroom.teacherId === req.user.id;
    const isEnrolled = await prisma.enrollment.findUnique({
      where: {
        classroomId_studentId: {
          classroomId: req.params.classroomId,
          studentId: req.user.id,
        },
      },
    });

    if (!isOwner && !isEnrolled) {
      return res.status(403).json({ error: 'Not enrolled in this classroom' });
    }

    // Broadcasts are keyed by roomId in Redis. By convention in this app the
    // broadcast roomId equals the classroomId (see BroadcastButton.jsx), so we
    // can fetch directly without scanning the keyspace.
    //
    // (The previous implementation scanned `broadcast:*:edge` — a pattern that
    // never matched any key — and called `prisma.broadcast`, a model that does
    // not exist in the schema. It always returned [] or threw at runtime.)
    const redisClient = req.app.locals.redisClient;
    const broadcasts = [];
    const broadcast = await redisClient.getBroadcast(req.params.classroomId);
    if (broadcast && broadcast.status === 'active') {
      broadcasts.push({
        roomId: broadcast.roomId,
        classroomId: classroom.id,
        teacherId: classroom.teacherId,
        startedAt: broadcast.startTime,
        viewerCount: broadcast.viewerCount || 0,
        edgeServerIds: broadcast.edgeServers || [],
      });
    }

    res.json({ broadcasts });
  } catch (err) {
    log.error('List broadcasts error:', err);
    res.status(500).json({ error: 'Failed to list broadcasts' });
  }
});

export default router;
