/**
 * Recording Routes (System-Manager)
 * 
 * REST API for recording management:
 * - POST   /api/recordings/start           – Teacher: Start recording
 * - POST   /api/recordings/:id/stop        – Teacher: Stop recording
 * - GET    /api/classrooms/:id/recordings  – Get all recordings in classroom
 * - GET    /api/recordings/:id             – Get recording details
 * - GET    /api/recordings/:id/download    – Get pre-signed URL (with access check)
 * - POST   /api/recordings/:id/permissions – Grant access to another user
 * - DELETE /api/recordings/:id/permissions/:userId – Revoke access
 * - DELETE /api/recordings/:id             – Delete recording (owner only)
 */

import { Router } from 'express';
import prisma from '../services/prisma.js';
import { verifyToken, verifyRole } from '../middleware/auth.js';
import { verifyClassroomAccess } from '../middleware/verifyClassroomAccess.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('recording:routes');
const router = Router();

/**
 * POST /api/recordings/start
 * Start recording a broadcast (teacher only)
 * Body: { classroomId, roomId, title, description }
 * Returns: { recordingId, status, message }
 */
router.post('/start', verifyToken, verifyRole('TEACHER'), async (req, res) => {
  log.debug(`📹 POST /api/recordings/start - teacher: ${req.user.email}`);
  try {
    const { classroomId, roomId, title, description, accessType } = req.body;

    if (!classroomId || !roomId) {
      return res.status(400).json({ error: 'classroomId and roomId are required' });
    }

    // Validate accessType if provided
    const validAccessTypes = ['PRIVATE', 'CLASSROOM', 'PUBLIC'];
    const finalAccessType = accessType && validAccessTypes.includes(accessType) ? accessType : 'CLASSROOM';

    // Verify teacher owns this classroom
    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId },
    });

    if (!classroom || classroom.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this classroom' });
    }

    // Create recording in DB
    const recording = await prisma.recording.create({
      data: {
        classroomId,
        teacherId: req.user.id,
        broadcastId: roomId,
        title: title || 'Untitled Recording',
        description: description || '',
        status: 'RECORDING',
        accessType: finalAccessType,
      },
    });

    // Publish to Redis for real-time updates + signal Origin to start recording
    const redisClient = req.app.locals.redisClient;
    if (redisClient) {
      try {
        // 1. Notify UI of recording start
        await redisClient.publish('recording:status', JSON.stringify({
          recordingId: recording.id,
          roomId,
          status: 'started',
          timestamp: Date.now(),
        }));

        // 2. Signal Origin to actually start capturing
        await redisClient.publish('recording:control', JSON.stringify({
          type: 'start',
          recordingId: recording.id,
          roomId,
          filename: `${recording.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.mp4`,
        }));
      } catch (err) {
        log.warn('Redis publish failed (non-critical):', err.message);
      }
    }

    log.info(`✅ Recording started: ${recording.id} by ${req.user.email}`);

    res.json({
      recordingId: recording.id,
      status: 'RECORDING',
      message: 'Recording started. Click stop to finish.',
      recordingStarted: recording.recordingStarted,
    });
  } catch (err) {
    log.error('Failed to start recording:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/recordings/:id/stop
 * Stop recording (teacher who started it)
 * Body: { duration, fileSize }
 * Returns: { recordingId, status, s3Url }
 */
router.post('/:id/stop', verifyToken, verifyRole('TEACHER'), async (req, res) => {
  log.debug(`⏹️  POST /api/recordings/${req.params.id}/stop - teacher: ${req.user.email}`);
  try {
    const { duration, fileSize } = req.body;

    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      include: { classroom: true },
    });

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Verify teacher owns the classroom
    if (recording.classroom.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this recording' });
    }

    // Update recording to PROCESSING (will be updated to READY by Origin when upload completes)
    const updated = await prisma.recording.update({
      where: { id: req.params.id },
      data: {
        status: 'PROCESSING',
        recordingEnded: new Date(),
        duration: duration || 0,
        fileSize: BigInt(fileSize || 0),
      },
    });

    // Signal Origin to finalize recording and upload to S3
    const redisClient = req.app.locals.redisClient;
    if (redisClient) {
      try {
        // Notify UI of stop
        await redisClient.publish('recording:status', JSON.stringify({
          recordingId: recording.id,
          roomId: recording.broadcastId,
          status: 'stopped',
          duration,
          timestamp: Date.now(),
        }));

        // Signal Origin to stop FFmpeg and finalize upload
        await redisClient.publish('recording:control', JSON.stringify({
          type: 'stop',
          recordingId: recording.id,
          roomId: recording.broadcastId,
        }));
      } catch (err) {
        log.warn('Redis publish failed (non-critical):', err.message);
      }
    }

    log.info(`✅ Recording stopped: ${recording.id} (${duration}s)`);

    res.json({
      recordingId: updated.id,
      status: updated.status,
      message: 'Recording completed. Processing started.',
      s3Url: updated.s3Url,
      recordingEnded: updated.recordingEnded,
    });
  } catch (err) {
    log.error('Failed to stop recording:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/classrooms/:classroomId/recordings
 * List all recordings in a classroom (teacher + enrolled students)
 * Query: { status, sort, limit }
 */
router.get(
  '/classrooms/:classroomId',
  verifyToken,
  verifyClassroomAccess((req) => req.params.classroomId),
  async (req, res) => {
  log.debug(`📋 GET /api/classrooms/${req.params.classroomId}/recordings`);
  try {
    const { classroomId } = req.params;
    const { status, sort = 'recent', limit = 50 } = req.query;
    const { isTeacher } = req.userAccess;

    // Build query — push the student access filter into the SQL `where` so
    // we don't load PRIVATE recordings only to discard them in JS. Also lets
    // the new (classroomId, status) composite index actually do work.
    const where = {
      classroomId,
      ...(status && { status }),
      ...(isTeacher
        ? {}
        : {
            OR: [
              { accessType: 'CLASSROOM' },
              { accessType: 'PUBLIC' },
              { accessType: 'PRIVATE', permissions: { some: { userId: req.user.id } } },
            ],
          }),
    };

    const orderBy = {
      recent: { recordingStarted: 'desc' },
      oldest: { recordingStarted: 'asc' },
      largest: { fileSize: 'desc' },
    }[sort] ||
      { recordingStarted: 'desc' };

    // Clamp pagination — without this, parseInt('-1') returns -1 (negative
    // take is rejected by Prisma) and parseInt('99999') would let a single
    // request fan out arbitrarily large reads.
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));

    const recordings = await prisma.recording.findMany({
      where,
      orderBy,
      take: parsedLimit,
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        permissions: isTeacher,
      },
    });

    log.info(`Retrieved ${recordings.length} recordings from ${classroomId}`);

    res.json({
      classroomId,
      total: recordings.length,
      recordings: recordings.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        duration: r.duration,
        fileSize: r.fileSize.toString(),
        status: r.status,
        recordingStarted: r.recordingStarted,
        recordingEnded: r.recordingEnded,
        teacher: r.teacher,
        accessType: r.accessType,
      })),
    });
  } catch (err) {
    log.error('Failed to list recordings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recordings/:id
 * Get recording details (with access check)
 */
router.get('/:id', verifyToken, async (req, res) => {
  log.debug(`📖 GET /api/recordings/${req.params.id}`);
  try {
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        classroom: { select: { id: true, name: true } },
        permissions: req.user.role === 'TEACHER' ? true : false,
      },
    });

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Check access
    const isOwner = recording.teacherId === req.user.id;
    const hasPermission = recording.permissions?.some((p) => p.userId === req.user.id);
    const isClassroomAccess = recording.accessType === 'CLASSROOM';

    if (!isOwner && !hasPermission && !isClassroomAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      id: recording.id,
      title: recording.title,
      description: recording.description,
      duration: recording.duration,
      fileSize: recording.fileSize.toString(),
      status: recording.status,
      accessType: recording.accessType,
      teacher: recording.teacher,
      classroom: recording.classroom,
      recordingStarted: recording.recordingStarted,
      recordingEnded: recording.recordingEnded,
      createdAt: recording.createdAt,
      updatedAt: recording.updatedAt,
    });
  } catch (err) {
    log.error('Failed to get recording:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/recordings/:id/download
 * Get pre-signed URL for downloading (with access check)
 * Query: { expiresIn } – URL expiration in seconds (default 1 hour)
 */
router.get('/:id/download', verifyToken, async (req, res) => {
  log.debug(`⬇️  GET /api/recordings/${req.params.id}/download - user: ${req.user.email}`);
  try {
    const { expiresIn = 3600 } = req.query;

    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      include: { permissions: true },
    });

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Check access
    const isOwner = recording.teacherId === req.user.id;
    const hasPermission = recording.permissions?.some((p) => p.userId === req.user.id);

    if (!isOwner && !hasPermission && recording.accessType !== 'CLASSROOM') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (recording.status !== 'READY') {
      return res.status(400).json({ error: 'Recording is still processing' });
    }

    // Get S3 service
    const s3Service = req.app.locals.s3Service;
    if (!s3Service) {
      return res.status(500).json({ error: 'S3 service not available' });
    }

    // Check if recording has an S3 key
    if (!recording.s3Key) {
      return res.status(400).json({ error: 'Recording has no associated file (s3Key missing)' });
    }

    // Generate presigned URL (now async)
    const presignedUrl = await s3Service.generatePresignedUrl(recording.s3Key, parseInt(expiresIn));

    // Extract extension from s3Key (webm or mp4)
    const extension = recording.s3Key?.split('.').pop() || 'webm';

    log.info(`✅ Presigned URL generated for ${recording.id}`);

    res.json({
      recordingId: recording.id,
      presignedUrl,
      expiresIn: parseInt(expiresIn),
      filename: `${recording.title}.${extension}`,
    });
  } catch (err) {
    log.error('Failed to generate download URL:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/recordings/:id/accessibility
 * Update recording accessibility settings (teacher only)
 * Body: { accessType: 'PRIVATE' | 'CLASSROOM' | 'PUBLIC', expiresAt?: string }
 */
router.patch('/:id/accessibility', verifyToken, verifyRole('TEACHER'), async (req, res) => {
  log.debug(`🔒 PATCH /api/recordings/${req.params.id}/accessibility`);
  try {
    const { accessType, expiresAt } = req.body;

    // Validate accessType
    const validTypes = ['PRIVATE', 'CLASSROOM', 'PUBLIC'];
    if (!accessType || !validTypes.includes(accessType)) {
      return res.status(400).json({ 
        error: 'Invalid accessType. Must be PRIVATE, CLASSROOM, or PUBLIC' 
      });
    }

    // Find recording and verify ownership
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
    });

    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recording.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this recording' });
    }

    // Update recording
    const updated = await prisma.recording.update({
      where: { id: req.params.id },
      data: {
        accessType,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    log.info(`✅ Recording ${req.params.id} accessibility updated to ${accessType}`);

    res.json({
      recordingId: updated.id,
      accessType: updated.accessType,
      expiresAt: updated.expiresAt,
      message: `Recording is now ${accessType.toLowerCase()}`,
    });
  } catch (err) {
    log.error('Failed to update recording accessibility:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/recordings/:id/permissions
 * Grant access to another user (teacher only)
 * Body: { userId, accessLevel }
 */
router.post('/:id/permissions', verifyToken, verifyRole('TEACHER'), async (req, res) => {
  log.debug(`🔐 POST /api/recordings/${req.params.id}/permissions`);
  try {
    const { userId, accessLevel = 'view' } = req.body;

    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
    });

    if (!recording || recording.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const permission = await prisma.recordingPermission.upsert({
      where: { recordingId_userId: { recordingId: req.params.id, userId } },
      update: { accessLevel, grantedAt: new Date() },
      create: {
        recordingId: req.params.id,
        userId,
        accessLevel,
        grantedBy: req.user.id,
      },
    });

    log.info(`✅ Permission granted: ${req.params.id} → ${userId}`);

    res.json({
      recordingId: req.params.id,
      userId,
      accessLevel: permission.accessLevel,
      grantedAt: permission.grantedAt,
    });
  } catch (err) {
    log.error('Failed to grant permission:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/recordings/:id/permissions/:userId
 * Revoke access (teacher only)
 */
router.delete('/:id/permissions/:userId', verifyToken, verifyRole('TEACHER'), async (req, res) => {
  log.debug(`🔓 DELETE /api/recordings/${req.params.id}/permissions/${req.params.userId}`);
  try {
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
    });

    if (!recording || recording.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.recordingPermission.delete({
      where: { recordingId_userId: { recordingId: req.params.id, userId: req.params.userId } },
    });

    log.info(`✅ Permission revoked: ${req.params.id} ← ${req.params.userId}`);

    res.json({ message: 'Permission revoked' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Permission not found' });
    }
    log.error('Failed to revoke permission:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/recordings/:id
 * Delete recording (owner only)
 * This removes metadata but doesn't delete S3 object (archive it instead)
 */
router.delete('/:id', verifyToken, verifyRole('TEACHER'), async (req, res) => {
  log.debug(`🗑️  DELETE /api/recordings/${req.params.id}`);
  try {
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
    });

    if (!recording || recording.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Mark as archived instead of deleting (good for audit)
    const updated = await prisma.recording.update({
      where: { id: req.params.id },
      data: { status: 'ARCHIVED' },
    });

    log.info(`✅ Recording deleted: ${req.params.id}`);

    res.json({ message: 'Recording archived', recordingId: updated.id });
  } catch (err) {
    log.error('Failed to delete recording:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
