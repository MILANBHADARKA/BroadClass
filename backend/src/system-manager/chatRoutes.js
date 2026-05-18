import { Router } from 'express';
import prisma from '../services/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { verifyClassroomAccess } from '../middleware/verifyClassroomAccess.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('chat:routes');
const router = Router();

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * GET /api/chat/broadcasts/:broadcastId/messages
 *
 * Returns messages for a broadcast in chronological order, newest first.
 * Pagination: `cursor` (a message id) + `limit`. The client typically
 * loads the latest page, then if the user scrolls up, requests older
 * messages by passing the oldest id as `cursor`.
 *
 * Filters out HIDDEN_BY_MODERATION for non-teachers; teachers can see
 * everything for moderation review.
 */
router.get(
  '/broadcasts/:broadcastId/messages',
  verifyToken,
  verifyClassroomAccess((req) => req.params.broadcastId),
  async (req, res) => {
    try {
      const { broadcastId } = req.params;
      const { isTeacher } = req.userAccess;
      const limit = Math.max(
        1,
        Math.min(MAX_PAGE_SIZE, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE),
      );
      const cursor = req.query.cursor || null;

      // Hidden-by-moderation messages are visible to teachers (so they can
      // review/restore) but not to students. Hidden-by-teacher messages are
      // hidden for everyone except the original author.
      const statusFilter = isTeacher
        ? { not: 'HIDDEN_BY_TEACHER' }  // teacher sees everything except their own hides
        : { in: ['VISIBLE', 'AWAITING_TEACHER', 'ANSWERED_BY_TEACHER'] };

      const where = {
        broadcastId,
        status: statusFilter,
      };

      const messages = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,  // +1 lets us know if there's a next page
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          user: { select: { id: true, name: true, role: true } },
          _count: { select: { upvotes: true } },
        },
      });

      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;
      const nextCursor = hasMore ? page[page.length - 1].id : null;

      // Reverse so the client gets oldest→newest within the page (most chat
      // UIs render top-to-bottom that way).
      page.reverse();

      // Hydrate AI_ANSWER citations: fetch all referenced TranscriptChunk
      // rows in one query, then stitch back. Live messages already include
      // these inline via the Redis fan-out path (chatSocketHandlers), but
      // history loads need to re-join.
      const allChunkIds = new Set();
      for (const m of page) {
        if (m.role === 'AI_ANSWER' && Array.isArray(m.sourceChunkIds)) {
          for (const id of m.sourceChunkIds) allChunkIds.add(id);
        }
      }
      let chunkById = new Map();
      if (allChunkIds.size > 0) {
        const rows = await prisma.transcriptChunk.findMany({
          where: { id: { in: Array.from(allChunkIds) } },
          select: { id: true, text: true, startMs: true, endMs: true },
        });
        chunkById = new Map(rows.map((r) => [r.id, r]));
      }

      res.json({
        broadcastId,
        messages: page.map((m) => serializeMessage(m, chunkById)),
        nextCursor,
      });
    } catch (err) {
      log.error('Failed to list chat messages:', err);
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * GET /api/chat/broadcasts/:broadcastId/queue
 *
 * Teacher Q&A queue — questions that AI declined or the system fell through
 * to the broadcaster. Sorted by upvotes (descending) then by createdAt
 * (ascending), so the most-wanted questions surface first and ties resolve
 * to the oldest pending question.
 *
 * Teacher-only. Other users get 403.
 */
router.get(
  '/broadcasts/:broadcastId/queue',
  verifyToken,
  verifyClassroomAccess((req) => req.params.broadcastId),
  async (req, res) => {
    try {
      if (!req.userAccess.isTeacher) {
        return res.status(403).json({ error: 'Teacher only' });
      }
      const { broadcastId } = req.params;
      // Fetch raw rows + upvote counts, then sort in app code (Prisma's
      // orderBy can't easily do "count(upvotes) desc, createdAt asc"
      // without a raw query and the row volume here is tiny anyway —
      // a broadcast usually has < 50 pending questions).
      const rows = await prisma.chatMessage.findMany({
        where: { broadcastId, status: 'AWAITING_TEACHER' },
        include: {
          user: { select: { id: true, name: true, role: true } },
          _count: { select: { upvotes: true } },
        },
      });
      rows.sort((a, b) => {
        const da = (b._count?.upvotes ?? 0) - (a._count?.upvotes ?? 0);
        if (da !== 0) return da;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      res.json({
        broadcastId,
        queue: rows.map((m) => serializeMessage(m)),
      });
    } catch (err) {
      log.error('Failed to list teacher queue:', err);
      res.status(500).json({ error: err.message });
    }
  },
);

/**
 * POST /api/chat/messages/:messageId/answer
 * Body: { content: string }
 *
 * Teacher writes a reply to a queued question. We create a TEACHER_ANSWER
 * row threaded to the original, flip the original to ANSWERED_BY_TEACHER,
 * and fan out both events via Redis.
 */
router.post('/messages/:messageId/answer', verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      return res.status(400).json({ error: 'content required' });
    }
    if (content.length > 4000) {
      return res.status(400).json({ error: 'Answer too long (4000 char max)' });
    }

    const question = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true, broadcastId: true, classroomId: true, status: true, broadcastMs: true,
      },
    });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const classroom = await prisma.classroom.findUnique({
      where: { id: question.classroomId },
      select: { teacherId: true },
    });
    if (!classroom || classroom.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Only the classroom teacher can answer questions' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const answer = await tx.chatMessage.create({
        data: {
          broadcastId: question.broadcastId,
          classroomId: question.classroomId,
          userId: req.user.id,
          role: 'TEACHER_ANSWER',
          content,
          parentId: question.id,
          status: 'VISIBLE',
          broadcastMs: question.broadcastMs,
        },
        include: {
          user: { select: { id: true, name: true, role: true } },
        },
      });
      const updatedQuestion = await tx.chatMessage.update({
        where: { id: question.id },
        data: { status: 'ANSWERED_BY_TEACHER' },
        select: { id: true, broadcastId: true, status: true },
      });
      return { answer, updatedQuestion };
    });

    const wire = serializeMessage(result.answer);

    // Fan out: the answer as a new chat:message, plus a status-update for
    // the parent question so the queue panel and chat both react.
    const redisClient = req.app.locals.redisClient;
    if (redisClient) {
      await Promise.allSettled([
        redisClient.publish('chat:message', JSON.stringify(wire)),
        redisClient.publish(
          'chat:status-update',
          JSON.stringify({
            messageId: result.updatedQuestion.id,
            broadcastId: result.updatedQuestion.broadcastId,
            status: result.updatedQuestion.status,
            timestamp: Date.now(),
          }),
        ),
      ]);
    }

    res.json({ answer: wire, questionId: question.id, questionStatus: 'ANSWERED_BY_TEACHER' });
  } catch (err) {
    log.error('Teacher answer failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/messages/:messageId/dismiss
 *
 * Teacher drops a question without answering (off-topic, duplicate, etc.).
 * Status → HIDDEN_BY_TEACHER. No reply row created.
 */
router.post('/messages/:messageId/dismiss', verifyToken, async (req, res) => {
  try {
    const updated = await _teacherStatusChange({
      req,
      messageId: req.params.messageId,
      newStatus: 'HIDDEN_BY_TEACHER',
    });
    if (updated.error) return res.status(updated.status).json({ error: updated.error });
    res.json({ messageId: updated.message.id, status: updated.message.status });
  } catch (err) {
    log.error('Teacher dismiss failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/messages/:messageId/mark-answered
 *
 * Teacher said the answer aloud during the lecture instead of typing it.
 * Status → ANSWERED_BY_TEACHER but no TEACHER_ANSWER message is created.
 * Students see the "answered" badge on the original question.
 */
router.post('/messages/:messageId/mark-answered', verifyToken, async (req, res) => {
  try {
    const updated = await _teacherStatusChange({
      req,
      messageId: req.params.messageId,
      newStatus: 'ANSWERED_BY_TEACHER',
    });
    if (updated.error) return res.status(updated.status).json({ error: updated.error });
    res.json({ messageId: updated.message.id, status: updated.message.status });
  } catch (err) {
    log.error('Teacher mark-answered failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/chat/messages/:messageId/upvote
 *
 * Toggle a +1 on a message. If the user has already upvoted, this removes
 * the upvote (acts like a "second click cancels"). Returns the new total.
 */
router.post('/messages/:messageId/upvote', verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, broadcastId: true, classroomId: true },
    });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Require classroom membership before allowing votes. Otherwise random
    // authenticated users could spam upvotes on broadcasts they have no
    // business participating in.
    const access = await getAccess(message.classroomId, req.user);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Upsert/toggle via a transaction so concurrent clicks can't double-vote.
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.chatUpvote.findUnique({
        where: { messageId_userId: { messageId, userId: req.user.id } },
      });
      if (existing) {
        await tx.chatUpvote.delete({ where: { id: existing.id } });
      } else {
        await tx.chatUpvote.create({
          data: { messageId, userId: req.user.id },
        });
      }
      const count = await tx.chatUpvote.count({ where: { messageId } });
      return { upvoted: !existing, count };
    });

    res.json({ messageId, ...result });
  } catch (err) {
    log.error('Upvote failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/chat/messages/:messageId
 *
 * Soft-hide a message. Teacher of the classroom only. We never hard-delete
 * because Phase 4 lets teachers answer questions, and an orphan reply with
 * no parent question is confusing.
 */
router.delete('/messages/:messageId', verifyToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, classroomId: true, userId: true, status: true },
    });
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const classroom = await prisma.classroom.findUnique({
      where: { id: message.classroomId },
      select: { teacherId: true },
    });
    if (!classroom || classroom.teacherId !== req.user.id) {
      return res.status(403).json({ error: 'Only the classroom teacher can hide messages' });
    }

    const updated = await prisma.chatMessage.update({
      where: { id: messageId },
      data: { status: 'HIDDEN_BY_TEACHER' },
    });

    // Notify the room so clients can drop the message from view immediately.
    const redisClient = req.app.locals.redisClient;
    if (redisClient) {
      await redisClient.publish(
        'chat:status-update',
        JSON.stringify({
          messageId: updated.id,
          broadcastId: updated.broadcastId,
          status: updated.status,
          timestamp: Date.now(),
        }),
      ).catch((err) => log.warn('chat:status-update publish failed:', err.message));
    }

    res.json({ messageId, status: updated.status });
  } catch (err) {
    log.error('Hide message failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── Helpers ──────────────────────────────────────────────────────── */

/**
 * Shared logic for `dismiss` and `mark-answered`. Verifies the caller is
 * the classroom teacher, flips the status, publishes a status-update.
 *
 * Returns { message } on success or { error, status } on failure so the
 * caller can map to an HTTP response.
 */
async function _teacherStatusChange({ req, messageId, newStatus }) {
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, broadcastId: true, classroomId: true, status: true },
  });
  if (!message) return { error: 'Message not found', status: 404 };

  const classroom = await prisma.classroom.findUnique({
    where: { id: message.classroomId },
    select: { teacherId: true },
  });
  if (!classroom || classroom.teacherId !== req.user.id) {
    return { error: 'Only the classroom teacher can perform this action', status: 403 };
  }

  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { status: newStatus },
    select: { id: true, broadcastId: true, status: true },
  });

  const redisClient = req.app.locals.redisClient;
  if (redisClient) {
    await redisClient.publish(
      'chat:status-update',
      JSON.stringify({
        messageId: updated.id,
        broadcastId: updated.broadcastId,
        status: updated.status,
        timestamp: Date.now(),
      }),
    ).catch((err) => log.warn('chat:status-update publish failed:', err.message));
  }
  return { message: updated };
}

/**
 * Resolve a user's relationship to a classroom. Returns null if neither
 * teacher nor enrolled student.
 */
async function getAccess(classroomId, user) {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { teacherId: true },
  });
  if (!classroom) return null;
  if (classroom.teacherId === user.id) return { isTeacher: true };
  const enrollment = await prisma.enrollment.findUnique({
    where: { classroomId_studentId: { classroomId, studentId: user.id } },
    select: { id: true },
  });
  return enrollment ? { isTeacher: false } : null;
}

/**
 * Project a Prisma chat row into the wire shape. Strips fields the client
 * doesn't need and stringifies BigInts (none here, but consistent with
 * other routes).
 *
 * `chunkById` is an optional Map<chunkId, {id, text, startMs, endMs}> used
 * to hydrate `aiCitations` for AI_ANSWER messages. Omit it for non-history
 * paths where the chunk data already lives inline on the wire payload.
 */
function serializeMessage(m, chunkById) {
  const out = {
    id: m.id,
    broadcastId: m.broadcastId,
    classroomId: m.classroomId,
    role: m.role,
    content: m.content,
    parentId: m.parentId,
    status: m.status,
    broadcastMs: m.broadcastMs,
    aiConfidence: m.aiConfidence,
    sourceChunkIds: m.sourceChunkIds,
    upvoteCount: m._count?.upvotes ?? 0,
    user: m.user
      ? { id: m.user.id, name: m.user.name, role: m.user.role }
      : null,
    createdAt: m.createdAt,
  };
  if (m.role === 'AI_ANSWER' && chunkById && Array.isArray(m.sourceChunkIds)) {
    out.aiCitations = m.sourceChunkIds
      .map((id) => chunkById.get(id))
      .filter(Boolean)
      .map((c) => ({ id: c.id, startMs: c.startMs, endMs: c.endMs, text: c.text }));
  }
  return out;
}

export default router;
