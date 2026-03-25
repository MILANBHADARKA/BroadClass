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

    // Verify user is enrolled in this classroom (if student)
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
        log.warn('DB enrollment check failed:', dbErr.message);
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

    // Get active broadcasts from Redis
    // Key pattern: broadcast:{roomId}:edge
    const broadcastKeys = await redisClient.keys(`broadcast:*:edge`);
    const broadcasts = [];

    for (const key of broadcastKeys) {
      const edgeData = await redisClient.get(key);
      const roomId = key.split(':')[1];

      // Check if this room belongs to this classroom
      const broadcast = await prisma.broadcast.findUnique({
        where: { roomId },
        include: { classroom: true },
      });

      if (broadcast && broadcast.classroomId === req.params.classroomId) {
        const edge = JSON.parse(edgeData);
        broadcasts.push({
          roomId,
          teacherId: broadcast.teacherId,
          classroomId: broadcast.classroomId,
          startedAt: broadcast.startedAt,
          viewerCount: edge.currentViewers || 0,
          edgeServerId: edge.serverId,
        });
      }
    }

    res.json({ broadcasts });
  } catch (err) {
    log.error('List broadcasts error:', err);
    res.status(500).json({ error: 'Failed to list broadcasts' });
  }
});

export default router;
