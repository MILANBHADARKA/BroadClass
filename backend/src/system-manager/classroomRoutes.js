/**
 * Classroom REST Routes (System-Manager)
 *
 * POST   /api/classrooms          – Create classroom (TEACHER only)
 * GET    /api/classrooms          – List my classrooms (teacher → owned, student → enrolled)
 * GET    /api/classrooms/:id      – Get classroom details
 * POST   /api/classrooms/join     – Join classroom by code (STUDENT only)
 * DELETE /api/classrooms/:id/leave – Leave classroom (STUDENT only)
 * DELETE /api/classrooms/:id      – Delete classroom (TEACHER owner only)
 * PATCH  /api/classrooms/:id      – Update classroom (TEACHER owner only)
 * POST   /api/classrooms/:id/regenerate-code – Regenerate join code (TEACHER owner only)
 */
import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../services/prisma.js';
import { verifyToken, verifyRole } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('classroom:routes');
const router = Router();

router.use(verifyToken);

/** Generate a unique 6-char alphanumeric code */
async function generateUniqueCode() {
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const exists = await prisma.classroom.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique classroom code');
}

// Create Classroom (TEACHER only)
router.post('/', verifyRole('TEACHER'), async (req, res) => {
  log.debug(`📝 [MANAGER] POST /api/classrooms - name: ${req.body.name}, teacher: ${req.user.email}`);
  try {
    const { name, description, subject } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Classroom name is required' });
    }

    const code = await generateUniqueCode();

    const classroom = await prisma.classroom.create({
      data: {
        name,
        description: description || null,
        subject: subject || null,
        code,
        teacherId: req.user.id,
      },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        _count: { select: { enrollments: true } },
      },
    });

    log.info(`✅ [SYSTEM-MANAGER] Classroom created via SYSTEM-MANAGER: "${name}" (${code}) by ${req.user.email}`);
    res.status(201).json({ classroom });
  } catch (err) {
    log.error('Create classroom error:', err);
    res.status(500).json({ error: 'Failed to create classroom' });
  }
});

// List My Classrooms
router.get('/', async (req, res) => {
  log.debug(`📝 [MANAGER] GET /api/classrooms - user: ${req.user.email} (${req.user.role})`);
  try {
    if (req.user.role === 'TEACHER') {
      const classrooms = await prisma.classroom.findMany({
        where: { teacherId: req.user.id },
        include: {
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      log.debug(`✅ [SYSTEM-MANAGER] Returned ${classrooms.length} classrooms for teacher`);
      return res.json({ classrooms });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: req.user.id },
      include: {
        classroom: {
          include: {
            teacher: { select: { id: true, name: true } },
            _count: { select: { enrollments: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const classrooms = enrollments.map((e) => ({
      ...e.classroom,
      joinedAt: e.joinedAt,
    }));

    res.json({ classrooms });
  } catch (err) {
    log.error('List classrooms error:', err);
    res.status(500).json({ error: 'Failed to list classrooms' });
  }
});

// Get Classroom Details
router.get('/:id', async (req, res) => {
  log.debug(`📝 [MANAGER] GET /api/classrooms/${req.params.id} - user: ${req.user.email}`);
  try {
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        enrollments: {
          include: { student: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'desc' },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!classroom) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    const isOwner = classroom.teacherId === req.user.id;
    const isEnrolled = classroom.enrollments.some((e) => e.studentId === req.user.id);

    if (!isOwner && !isEnrolled) {
      return res.status(403).json({ error: 'You do not have access to this classroom' });
    }

    if (!isOwner) {
      classroom.code = undefined;
    }

    log.debug(`✅ [SYSTEM-MANAGER] Returned classroom: ${classroom.name}`);
    res.json({ classroom });
  } catch (err) {
    log.error('Get classroom error:', err);
    res.status(500).json({ error: 'Failed to get classroom' });
  }
});

// Join Classroom by Code (STUDENT only)
router.post('/join', verifyRole('STUDENT'), async (req, res) => {
  log.debug(`📝 [MANAGER] POST /api/classrooms/join - code: ${req.body.code}, student: ${req.user.email}`);
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Classroom code is required' });
    }

    const classroom = await prisma.classroom.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        teacher: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
    });

    if (!classroom) {
      return res.status(404).json({ error: 'Invalid classroom code' });
    }

    const existing = await prisma.enrollment.findUnique({
      where: {
        classroomId_studentId: {
          classroomId: classroom.id,
          studentId: req.user.id,
        },
      },
    });

    if (existing) {
      return res.status(409).json({ error: 'Already enrolled in this classroom' });
    }

    await prisma.enrollment.create({
      data: {
        classroomId: classroom.id,
        studentId: req.user.id,
      },
    });

    log.info(`✅ [SYSTEM-MANAGER] Student joined via SYSTEM-MANAGER: ${req.user.email} → "${classroom.name}" (${code})`);
    res.json({
      message: `Joined "${classroom.name}" successfully`,
      classroom: {
        id: classroom.id,
        name: classroom.name,
        subject: classroom.subject,
        teacher: classroom.teacher,
        _count: { enrollments: classroom._count.enrollments + 1 },
      },
    });
  } catch (err) {
    log.error('Join classroom error:', err);
    res.status(500).json({ error: 'Failed to join classroom' });
  }
});

// Leave Classroom (STUDENT only)
router.delete('/:id/leave', verifyRole('STUDENT'), async (req, res) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        classroomId_studentId: {
          classroomId: req.params.id,
          studentId: req.user.id,
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Not enrolled in this classroom' });
    }

    await prisma.enrollment.delete({ where: { id: enrollment.id } });

    log.info(`Student ${req.user.email} left classroom ${req.params.id}`);
    res.json({ message: 'Left classroom successfully' });
  } catch (err) {
    log.error('Leave classroom error:', err);
    res.status(500).json({ error: 'Failed to leave classroom' });
  }
});

// Update Classroom (TEACHER owner only)
router.patch('/:id', verifyRole('TEACHER'), async (req, res) => {
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    if (classroom.teacherId !== req.user.id) return res.status(403).json({ error: 'Not your classroom' });

    const { name, description, subject, aiChatEnabled, transcriptionEnabled } = req.body;
    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(subject !== undefined && { subject }),
        // Smart Chat toggles — accept booleans only; ignore anything else.
        ...(typeof aiChatEnabled === 'boolean' && { aiChatEnabled }),
        ...(typeof transcriptionEnabled === 'boolean' && { transcriptionEnabled }),
      },
      include: {
        _count: { select: { enrollments: true } },
      },
    });

    res.json({ classroom: updated });
  } catch (err) {
    log.error('Update classroom error:', err);
    res.status(500).json({ error: 'Failed to update classroom' });
  }
});

// Delete Classroom (TEACHER owner only)
router.delete('/:id', verifyRole('TEACHER'), async (req, res) => {
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    if (classroom.teacherId !== req.user.id) return res.status(403).json({ error: 'Not your classroom' });

    await prisma.classroom.delete({ where: { id: req.params.id } });

    log.info(`Classroom deleted: ${req.params.id} by ${req.user.email}`);
    res.json({ message: 'Classroom deleted successfully' });
  } catch (err) {
    log.error('Delete classroom error:', err);
    res.status(500).json({ error: 'Failed to delete classroom' });
  }
});

// Regenerate Join Code (TEACHER owner only)
router.post('/:id/regenerate-code', verifyRole('TEACHER'), async (req, res) => {
  try {
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    if (classroom.teacherId !== req.user.id) return res.status(403).json({ error: 'Not your classroom' });

    const newCode = await generateUniqueCode();
    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { code: newCode },
    });

    log.info(`Code regenerated for classroom ${req.params.id}: ${newCode}`);
    res.json({ code: updated.code });
  } catch (err) {
    log.error('Regenerate code error:', err);
    res.status(500).json({ error: 'Failed to regenerate code' });
  }
});

export default router;
