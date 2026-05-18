import prisma from '../services/prisma.js';
import { createLogger } from '../utils/logger.js';
import { answerQuestion, moderateMessage } from './aiClient.js';

const log = createLogger('chat:socket');

// Channel names — must mirror ai-service/app/redis_client.py.
const CHANNEL_CHAT_MESSAGE = 'chat:message';
const CHANNEL_CHAT_STATUS = 'chat:status-update';
const CHANNEL_TRANSCRIPTION_CHUNK = 'transcription:chunk';

// Rate limit: 3 messages per 10s per user. Cheap in-memory sliding window.
// (For horizontally-scaled system-manager replicas we'd push this into
// Redis, but at single-instance scale this is fine.)
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10_000;
const _userSendHistory = new Map();  // userId → number[] (ms timestamps)

function _checkRate(userId) {
  const now = Date.now();
  const arr = (_userSendHistory.get(userId) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (arr.length >= RATE_LIMIT_MAX) {
    return { ok: false, retryInMs: RATE_LIMIT_WINDOW_MS - (now - arr[0]) };
  }
  arr.push(now);
  _userSendHistory.set(userId, arr);
  return { ok: true };
}

// Periodically drop history for users who haven't spoken in a while so the
// map doesn't grow unbounded on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [userId, arr] of _userSendHistory) {
    const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) _userSendHistory.delete(userId);
    else _userSendHistory.set(userId, fresh);
  }
}, RATE_LIMIT_WINDOW_MS * 6).unref();


/**
 * @param {object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {object} deps.redisClient — RedisClient instance with .client + duplicate()
 */
export function registerChatSocketHandlers({ io, redisClient }) {
  let pubsubSubscriber = null;

  const setupPubSub = async () => {
    pubsubSubscriber = redisClient.client.duplicate();
    await pubsubSubscriber.connect();
    await pubsubSubscriber.subscribe(
      [CHANNEL_CHAT_MESSAGE, CHANNEL_CHAT_STATUS, CHANNEL_TRANSCRIPTION_CHUNK],
      (raw, channel) => {
        let data;
        try { data = JSON.parse(raw); } catch {
          log.warn(`Malformed pubsub payload on ${channel}`);
          return;
        }
        const broadcastId = data.broadcastId;
        if (!broadcastId) return;
        const room = `chat:${broadcastId}`;

        if (channel === CHANNEL_CHAT_MESSAGE) {
          io.to(room).emit('chat:message', data);
        } else if (channel === CHANNEL_CHAT_STATUS) {
          io.to(room).emit('chat:status-update', data);
        } else if (channel === CHANNEL_TRANSCRIPTION_CHUNK) {
          // Live transcript stream — same room as chat so the UI can use
          // a single socket connection. High frequency (interim updates
          // every ~200ms), so we trust the Socket.IO Redis adapter to
          // keep this scoped to room subscribers only.
          io.to(room).emit('transcription:chunk', data);
        }
      },
    );
    log.info(
      `Subscribed to ${CHANNEL_CHAT_MESSAGE}, ${CHANNEL_CHAT_STATUS}, ${CHANNEL_TRANSCRIPTION_CHUNK}`,
    );
  };
  setupPubSub().catch((err) => log.error('chat pubsub setup failed:', err));

  io.on('connection', (socket) => {
    if (!socket.user) {
      // Defensive: should be impossible if socketAuthMiddleware is wired.
      log.warn('chat: connection without socket.user — refusing chat events');
      return;
    }

    socket.on('chat:join-room', async ({ broadcastId }, ack) => {
      if (!broadcastId) {
        return ack?.({ error: 'broadcastId required' });
      }
      // In this app broadcastId === classroomId.
      const access = await _getAccess(broadcastId, socket.user);
      if (!access) {
        return ack?.({ error: 'Access denied' });
      }
      socket.join(`chat:${broadcastId}`);
      log.debug(`Socket ${socket.id} joined chat:${broadcastId}`);
      ack?.({ ok: true, isTeacher: access.isTeacher });
    });

    socket.on('chat:leave-room', ({ broadcastId }) => {
      if (!broadcastId) return;
      socket.leave(`chat:${broadcastId}`);
    });

    socket.on('chat:send', async ({ broadcastId, content, parentId, broadcastMs }, ack) => {
      try {
        if (!broadcastId || typeof content !== 'string') {
          return ack?.({ error: 'broadcastId and content required' });
        }
        const trimmed = content.trim();
        if (!trimmed) {
          return ack?.({ error: 'Message is empty' });
        }
        if (trimmed.length > 2000) {
          return ack?.({ error: 'Message too long (2000 char max)' });
        }

        const rate = _checkRate(socket.user.id);
        if (!rate.ok) {
          return ack?.({
            error: `Slow down — try again in ${Math.ceil(rate.retryInMs / 1000)}s`,
            retryInMs: rate.retryInMs,
          });
        }

        // Access check — re-verified per send to handle role changes
        // mid-session.
        const access = await _getAccess(broadcastId, socket.user);
        if (!access) {
          return ack?.({ error: 'Access denied' });
        }

        // Moderation (best-effort: failures allow). The ai-service /moderate
        // endpoint returns { allowed, flags }; we trust `allowed=false` to
        // mean hide on persist. A timeout / unreachable service falls
        // through to allow.
        let moderationFlags = [];
        let initialStatus = 'VISIBLE';
        try {
          const verdict = await moderateMessage(trimmed);
          if (verdict && !verdict.allowed) {
            initialStatus = 'HIDDEN_BY_MODERATION';
            moderationFlags = verdict.flags || [];
          } else if (verdict?.flags?.length) {
            moderationFlags = verdict.flags;
          }
        } catch (err) {
          log.warn('moderation check failed (allowing):', err.message);
        }

        // Persist.
        const created = await prisma.chatMessage.create({
          data: {
            broadcastId,
            classroomId: broadcastId,    // app convention: roomId === classroomId
            userId: socket.user.id,
            role: 'VIEWER_QUESTION',
            content: trimmed,
            parentId: parentId || null,
            broadcastMs: Number.isFinite(broadcastMs) ? broadcastMs : null,
            status: initialStatus,
            moderationFlags,
          },
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
        });

        // Build the wire payload once. Same shape used by the REST list endpoint.
        const wire = {
          id: created.id,
          broadcastId: created.broadcastId,
          classroomId: created.classroomId,
          role: created.role,
          content: created.content,
          parentId: created.parentId,
          status: created.status,
          broadcastMs: created.broadcastMs,
          aiConfidence: created.aiConfidence,
          sourceChunkIds: created.sourceChunkIds,
          upvoteCount: 0,
          user: created.user,
          createdAt: created.createdAt,
        };

        // ACK the sender immediately so optimistic UI can confirm and clear
        // the input. The pubsub fanout below will reach the sender too —
        // useChat dedupes by message id.
        ack?.({ ok: true, message: wire });

        // Fan-out via Redis so all system-manager replicas (and clients in
        // other regions, eventually) deliver to chat:${broadcastId} subscribers.
        await redisClient.publish(CHANNEL_CHAT_MESSAGE, JSON.stringify(wire))
          .catch((err) => log.warn('chat:message publish failed:', err.message));

        // Phase 3: fire-and-forget AI answer. The question itself is already
        // visible — the AI answer (or fall-through status update) lands as a
        // separate chat:message a few seconds later. We don't await this so
        // the ack returns immediately and the sender's UI clears the input.
        // Replies to other messages skip RAG (they're already conversational
        // turns; running RAG on every reply burns the Groq quota).
        //
        // Phase 5 toggle: respect classroom.aiChatEnabled. When OFF, every
        // top-level question goes straight to AWAITING_TEACHER without
        // calling Groq. Cost-control for teachers who want a pure-human
        // Q&A experience.
        if (initialStatus === 'VISIBLE' && !parentId) {
          _runAiPipeline({ redisClient, question: wire })
            .catch((err) => log.warn('AI answer pipeline crashed:', err.message));
        }

      } catch (err) {
        log.error('chat:send failed:', err);
        ack?.({ error: err.message || 'Send failed' });
      }
    });
  });

  return {
    shutdown: async () => {
      if (pubsubSubscriber) {
        try { await pubsubSubscriber.unsubscribe(); } catch {}
        try { await pubsubSubscriber.quit(); } catch {}
      }
    },
  };
}


/**
 * Top-level orchestrator: check the classroom's AI toggle, then either run
 * the RAG pipeline or short-circuit to the teacher queue.
 */
async function _runAiPipeline({ redisClient, question }) {
  let aiEnabled = true;
  try {
    const cls = await prisma.classroom.findUnique({
      where: { id: question.classroomId },
      select: { aiChatEnabled: true },
    });
    if (cls && cls.aiChatEnabled === false) aiEnabled = false;
  } catch (err) {
    log.warn('AI gate DB check failed (defaulting ON):', err.message);
  }
  if (!aiEnabled) {
    // No AI — every question goes to the teacher.
    return _markAwaitingTeacher({ redisClient, question });
  }
  return _handleAiAnswer({ redisClient, question });
}

/**
 * Async post-process for a student question: call the ai-service /answer,
 * persist either an AI_ANSWER child message OR mark the question
 * AWAITING_TEACHER, and fan the result out via Redis.
 *
 * Fire-and-forget from the chat:send ack path. Failures are logged but
 * don't surface to the student — chat must keep working when the AI
 * service is sad.
 */
async function _handleAiAnswer({ redisClient, question }) {
  const result = await answerQuestion({
    broadcastId: question.broadcastId,
    content: question.content,
  });

  // Null = ai-service unreachable / circuit-breaker open / timed out.
  // Treat the same as `answerable=false`: surface to the teacher.
  if (!result || !result.answerable) {
    await _markAwaitingTeacher({ redisClient, question });
    return;
  }

  // Hallucination guard (defense in depth — ai-service also enforces this).
  const citations = Array.isArray(result.citations) ? result.citations : [];
  if (!citations.length) {
    await _markAwaitingTeacher({ redisClient, question });
    return;
  }

  // Persist the AI answer as a threaded reply.
  try {
    const created = await prisma.chatMessage.create({
      data: {
        broadcastId: question.broadcastId,
        classroomId: question.classroomId,
        userId: question.user.id,        // attribute to the asker for FK safety;
                                          // role=AI_ANSWER disambiguates in the UI
        role: 'AI_ANSWER',
        content: result.answer || '',
        parentId: question.id,
        status: 'VISIBLE',
        broadcastMs: question.broadcastMs,
        aiConfidence: result.confidence || 'low',
        sourceChunkIds: citations.map((c) => c.id),
      },
    });

    const wire = {
      id: created.id,
      broadcastId: created.broadcastId,
      classroomId: created.classroomId,
      role: created.role,
      content: created.content,
      parentId: created.parentId,
      status: created.status,
      broadcastMs: created.broadcastMs,
      aiConfidence: created.aiConfidence,
      sourceChunkIds: created.sourceChunkIds,
      // Inline citation excerpts so the frontend can render chips without
      // a second fetch. Phase 5 will also reuse this for recording replay.
      aiCitations: citations.map((c) => ({
        id: c.id,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
      })),
      upvoteCount: 0,
      user: null,
      createdAt: created.createdAt,
    };

    await redisClient.publish(CHANNEL_CHAT_MESSAGE, JSON.stringify(wire))
      .catch((err) => log.warn('AI answer publish failed:', err.message));
  } catch (err) {
    log.error('Failed to persist AI answer:', err.message);
    // If we couldn't persist, fall back to the teacher queue.
    await _markAwaitingTeacher({ redisClient, question });
  }
}

/**
 * Mark a question as awaiting a teacher response (Phase 4 surfaces these in
 * a queue panel). Idempotent — safe to call when the question is already
 * in any other status; we only transition VISIBLE → AWAITING_TEACHER.
 */
async function _markAwaitingTeacher({ redisClient, question }) {
  try {
    const updated = await prisma.chatMessage.update({
      where: { id: question.id },
      data: { status: 'AWAITING_TEACHER' },
      select: { id: true, broadcastId: true, status: true },
    });
    await redisClient.publish(
      CHANNEL_CHAT_STATUS,
      JSON.stringify({
        messageId: updated.id,
        broadcastId: updated.broadcastId,
        status: updated.status,
        timestamp: Date.now(),
      }),
    ).catch((err) => log.warn('chat:status-update publish failed:', err.message));
  } catch (err) {
    log.warn('Failed to mark question AWAITING_TEACHER:', err.message);
  }
}

/**
 * Resolve a user's relationship to a classroom (= broadcastId in this app).
 */
async function _getAccess(classroomId, user) {
  try {
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
  } catch (err) {
    log.error('_getAccess failed:', err.message);
    return null;  // fail closed
  }
}

export default registerChatSocketHandlers;
