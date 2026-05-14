/**
 * Origin Socket.IO handlers
 * Handles: broadcaster transports, producing, consuming (fallback),
 * broadcast lifecycle, and piping triggers.
 */

import { mediaCodecs } from '../config/mediaCodecs.js';
import { createLogger } from '../utils/logger.js';
import { connectEdgeServers, cleanupPipes } from './pipeManager.js';
import prisma from '../services/prisma.js';

const log = createLogger('origin:socket');

/**
 * @param {object}  deps
 * @param {object}  deps.io               – Socket.IO server
 * @param {object}  deps.config
 * @param {object}  deps.redisClient
 * @param {Map}     deps.broadcasts       – shared originBroadcasts map
 * @param {object}  deps.state            – { rtpCapabilities, containerIp }
 * @param {Function} deps.getNextWorker
 * @param {OriginRecordingHandler} deps.recordingHandler – for recording lifecycle
 */
export function registerOriginSocketHandlers({ io, config, redisClient, broadcasts, state, getNextWorker, recordingHandler }) {
  /** Helper: build broadcast list for clients */
  async function getBroadcastList() {
    const entries = Array.from(broadcasts.entries());
    const list = await Promise.all(
      entries.map(async ([roomId, b]) => {
        const stored = await redisClient.getBroadcast(roomId);
        return {
          roomId,
          viewerCount: stored?.viewerCount ?? 0,
          hasVideo: b.producers.has('video'),
          hasAudio: b.producers.has('audio'),
        };
      }),
    );
    return list;
  }

  /** Cleanup a broadcast and all its resources */
  async function cleanupBroadcast(roomId, broadcasterId) {
    const broadcast = broadcasts.get(roomId);
    if (!broadcast || broadcast.broadcasterId !== broadcasterId) return;

    log.info(`Cleaning up broadcast: ${roomId}`);

    // Unregister from recording handler
    if (recordingHandler) {
      recordingHandler.unregisterBroadcastRoom(roomId);
    }

    // Cancel any pending grace timer
    const grace = broadcasterGraceTimers.get(roomId);
    if (grace) { clearTimeout(grace.timer); broadcasterGraceTimers.delete(roomId); }

    if (broadcast.pipeTimer) clearTimeout(broadcast.pipeTimer);

    await cleanupPipes(broadcast);

    broadcast.producers.forEach((p) => { try { p.close(); } catch (_) {} });
    try { broadcast.router.close(); } catch (_) {}

    broadcasts.delete(roomId);
    await redisClient.endBroadcast(roomId);

    log.info(`Broadcast cleaned up: ${roomId}`);
    io.emit('broadcastEnded', { roomId });
    io.emit('broadcastList', await getBroadcastList());

    // Publish to System-Manager via Redis
    try {
      await redisClient.publish('broadcast:list-updated', JSON.stringify({ action: 'ended', roomId }));
    } catch (err) {
      log.warn('Failed to publish broadcast update to Redis:', err.message);
    }
  }

  // Grace timers: roomId → { timer, lostSocketId, savedResources }
  // When a broadcaster disconnects, we wait 30s before full cleanup so the
  // teacher can reconnect (e.g. browser refresh) without kicking all students.
  const broadcasterGraceTimers = new Map();

  // Per-socket resource tracking
  const socketResources = new Map();

  io.on('connection', (socket) => {
    log.info(`Client connected: ${socket.id}`);

    socketResources.set(socket.id, {
      producerTransport: null,
      consumerTransport: null,
      producers: [],
      consumers: [],
      roomId: null,
      viewerCounted: false,
    });

    // Capabilities
    socket.on('getRouterRtpCapabilities', (cb) => cb(state.rtpCapabilities));

    // Broadcast List
    socket.on('getBroadcasts', async (cb) => cb(await getBroadcastList()));

    // Create Transport
    socket.on('createWebRtcTransport', async ({ sender, roomId }, cb) => {
      try {
        let broadcast = broadcasts.get(roomId);

        if (sender) {
          // ── TEACHER ONLY: verify classroom ownership ──
          if (!socket.user || socket.user.role !== 'TEACHER') {
            return cb({ error: 'Only teachers can broadcast' });
          }

          try {
            const classroom = await prisma.classroom.findUnique({
              where: { id: roomId },
            });
            if (!classroom) return cb({ error: 'Classroom not found' });
            if (classroom.teacherId !== socket.user.id) {
              return cb({ error: 'You do not own this classroom' });
            }
          } catch (dbErr) {
            log.warn('DB check failed, allowing broadcast:', dbErr.message);
          }

          if (broadcast?.broadcasterId && broadcast.broadcasterId !== socket.id) {
            // Allow reconnect only if the original broadcaster disconnected within the grace window
            const grace = broadcasterGraceTimers.get(roomId);
            if (!grace) {
              return cb({ error: `Room "${roomId}" already has a broadcaster` });
            }
            // Teacher reconnecting — cancel grace timer, reset broadcast state for fresh pipe
            clearTimeout(grace.timer);
            broadcasterGraceTimers.delete(roomId);
            grace.savedResources?.producers.forEach((p) => { try { p.close(); } catch (_) {} });
            try { grace.savedResources?.producerTransport?.close(); } catch (_) {}
            broadcast.pipeTransports.forEach((info) => { try { info.transport.close(); } catch (_) {} });
            broadcast.pipeTransports.clear();
            broadcast.edgeServers = [];
            broadcast.producers.clear();
            broadcast.piped = false;
            broadcast.broadcasterId = socket.id;
            log.info(`Teacher reconnected to ${roomId} with new socket ${socket.id}, ready for re-broadcast`);
          }

          if (!broadcast) {
            const router = await getNextWorker().createRouter({ mediaCodecs });
            broadcast = {
              roomId,
              router,
              broadcasterId: null,
              producers: new Map(),
              viewers: new Map(),
              pipeTransports: new Map(),
              edgeServers: [],
              pipeTimer: null,
              piped: false,
              createdAt: Date.now(),
            };
            broadcasts.set(roomId, broadcast);
            log.info(`Broadcast created: ${roomId}`);
            
            // Register with recording handler for capture
            if (recordingHandler) {
              recordingHandler.registerBroadcastRoom(roomId, broadcast);
              log.info(`Broadcast registered with recording handler: ${roomId}`);
            }
          }

          const transport = await broadcast.router.createWebRtcTransport({
            listenInfos: [
              { protocol: 'udp', ip: '0.0.0.0', announcedIp: config.announcedIp },
              { protocol: 'tcp', ip: '0.0.0.0', announcedIp: config.announcedIp },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 2_000_000,
          });

          const res = socketResources.get(socket.id);
          res.producerTransport = transport;
          res.roomId = roomId;

          cb({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
        } else {
          // Fallback viewer on origin
          if (!broadcast) return cb({ error: 'Broadcast not found' });

          // ── STUDENT ONLY: verify enrollment. Fail closed on DB errors —
          // otherwise a transient outage would let any authenticated student
          // join any classroom's broadcast.
          if (socket.user && socket.user.role === 'STUDENT') {
            try {
              const enrollment = await prisma.enrollment.findUnique({
                where: {
                  classroomId_studentId: {
                    classroomId: roomId,
                    studentId: socket.user.id,
                  },
                },
              });
              if (!enrollment) {
                return cb({ error: 'You are not enrolled in this classroom' });
              }
            } catch (dbErr) {
              log.error('DB enrollment check failed:', dbErr.message);
              return cb({ error: 'Enrollment check temporarily unavailable, please retry' });
            }
          }

          log.info(`Fallback viewer ${socket.id} on origin for ${roomId}`);

          const transport = await broadcast.router.createWebRtcTransport({
            listenInfos: [
              { protocol: 'udp', ip: '0.0.0.0', announcedIp: config.announcedIp },
              { protocol: 'tcp', ip: '0.0.0.0', announcedIp: config.announcedIp },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 2_000_000,
          });

          const res = socketResources.get(socket.id);
          res.consumerTransport = transport;
          res.roomId = roomId;

          cb({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
        }
      } catch (err) {
        log.error('Error creating transport:', err);
        cb({ error: err.message });
      }
    });

    // Connect Transport
    socket.on('connectTransport', async ({ transportId, dtlsParameters }, cb) => {
      try {
        const res = socketResources.get(socket.id);
        const transport =
          res.producerTransport?.id === transportId
            ? res.producerTransport
            : res.consumerTransport?.id === transportId
              ? res.consumerTransport
              : null;

        if (!transport) return cb({ error: 'Transport not found' });

        await transport.connect({ dtlsParameters });
        log.info(`Transport connected: ${transportId}`);
        cb({ success: true });
      } catch (err) {
        log.error('Error connecting transport:', err);
        cb({ error: err.message });
      }
    });

    // Start Broadcast (produce)
    socket.on('startBroadcast', async ({ roomId, rtpParameters, kind }, cb) => {
      try {
        const broadcast = broadcasts.get(roomId);
        if (!broadcast) return cb({ error: 'Broadcast not initialized' });

        if (!broadcast.broadcasterId) {
          broadcast.broadcasterId = socket.id;
          log.info(`Broadcaster ${socket.id} started: ${roomId}`);
        }

        const res = socketResources.get(socket.id);
        if (!res.producerTransport) return cb({ error: 'Producer transport not found' });

        const producer = await res.producerTransport.produce({ kind, rtpParameters });
        broadcast.producers.set(kind, producer);
        res.producers.push(producer);

        log.info(`Producer created – Room: ${roomId}, Kind: ${kind}`);

        // Register in Redis
        await redisClient.registerBroadcast(roomId, {
          originServer: `${config.announcedIp}:${config.port}`,
          producerId: producer.id,
          edgeServers: [],
          maxViewers: 250_000,
        });

        // Debounced pipe to edges (wait for all tracks)
        if (!broadcast.piped) {
          if (broadcast.pipeTimer) clearTimeout(broadcast.pipeTimer);
          broadcast.pipeTimer = setTimeout(async () => {
            broadcast.piped = true;
            await connectEdgeServers(roomId, broadcasts, redisClient, state.containerIp);
            await redisClient.registerBroadcast(roomId, {
              originServer: `${config.announcedIp}:${config.port}`,
              producerId: producer.id,
              edgeServers: broadcast.edgeServers,
              maxViewers: 250_000,
            });
          }, 2000);
        }

        cb({ producerId: producer.id });
        io.emit('broadcastList', await getBroadcastList());

        // Publish to System-Manager via Redis (on first producer)
        if (broadcast.producers.size === 1) {
          try {
            await redisClient.publish('broadcast:list-updated', JSON.stringify({ 
              action: 'created', 
              roomId,
              teacherId: socket.user?.id,
              startedAt: broadcast.createdAt,
            }));
          } catch (err) {
            log.warn('Failed to publish broadcast update to Redis:', err.message);
          }
        }
      } catch (err) {
        log.error('Error starting broadcast:', err);
        cb({ error: err.message });
      }
    });

    // Join Broadcast (fallback viewer)
    socket.on('joinBroadcast', async ({ roomId }, cb) => {
      try {
        const broadcast = broadcasts.get(roomId);
        if (!broadcast) return cb({ error: 'Broadcast not found' });

        if (!broadcast.viewers) broadcast.viewers = new Map();
        broadcast.viewers.set(socket.id, {
          socketId: socket.id,
          consumers: new Map(),
          joinedAt: Date.now(),
        });

        const res = socketResources.get(socket.id);
        res.roomId = roomId;

        // Increment first, mark counted only after Redis acknowledges. If the
        // socket disconnects mid-increment the disconnect handler will see
        // viewerCounted=false and skip the decrement, avoiding a negative count.
        try {
          await redisClient.updateBroadcastViewerCount(roomId, 1);
          res.viewerCounted = true;
        } catch (err) {
          log.warn(`Failed to increment viewer count for ${roomId}:`, err.message);
          // Continue the join — viewer count tracking is best-effort. A janitor
          // (or HINCRBY-based atomic update — see Phase 2.3) reconciles drift.
        }
        log.info(`Fallback viewer ${socket.id} joined ${roomId} (${broadcast.viewers.size} viewers)`);

        // Publish viewer count change to System-Manager
        try {
          const stored = await redisClient.getBroadcast(roomId);
          await redisClient.publish('broadcast:viewer-count', JSON.stringify({ 
            roomId, 
            viewerCount: stored?.viewerCount ?? 1
          }));
        } catch (err) {
          log.warn('Failed to publish viewer count to Redis:', err.message);
        }

        cb({ success: true });
        io.emit('broadcastList', await getBroadcastList());
      } catch (err) {
        log.error('Error joining broadcast:', err);
        cb({ error: err.message });
      }
    });

    // Consume (fallback viewer on origin)
    socket.on('consume', async ({ roomId, rtpCapabilities, kind }, cb) => {
      try {
        const broadcast = broadcasts.get(roomId);
        if (!broadcast?.producers.has(kind)) return cb({ error: `No ${kind} producer found` });

        const producer = broadcast.producers.get(kind);
        const res = socketResources.get(socket.id);
        if (!res.consumerTransport) return cb({ error: 'Consumer transport not found' });

        if (!broadcast.router.canConsume({ producerId: producer.id, rtpCapabilities })) {
          return cb({ error: 'Cannot consume this producer' });
        }

        const consumer = await res.consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        res.consumers.push(consumer);
        broadcast.viewers?.get(socket.id)?.consumers.set(kind, consumer);

        consumer.on('producerclose', () => socket.emit('producerClosed', { kind }));

        log.info(`Consumer created – ${roomId}, ${kind}, viewer ${socket.id} (origin fallback)`);
        cb({
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        log.error('Error consuming:', err);
        cb({ error: err.message });
      }
    });

    // Resume Consumer
    socket.on('resumeConsumer', async ({ consumerId }, cb) => {
      try {
        const consumer = socketResources.get(socket.id)?.consumers.find((c) => c.id === consumerId);
        if (!consumer) return cb({ error: 'Consumer not found' });
        await consumer.resume();
        log.info(`Consumer resumed: ${consumerId}`);
        cb({ resumed: true });
      } catch (err) {
        log.error('Error resuming consumer:', err);
        cb({ error: err.message });
      }
    });

    // Stop Broadcast
    socket.on('stopBroadcast', ({ roomId }) => cleanupBroadcast(roomId, socket.id));

    // Leave Broadcast
    socket.on('leaveBroadcast', ({ roomId }) => {
      const broadcast = broadcasts.get(roomId);
      const viewer = broadcast?.viewers?.get(socket.id);
      if (viewer) {
        viewer.consumers.forEach((c) => { try { c.close(); } catch (_) {} });
        broadcast.viewers.delete(socket.id);
      }

      const res = socketResources.get(socket.id);
      if (res?.viewerCounted) {
        res.viewerCounted = false;
        redisClient.updateBroadcastViewerCount(roomId, -1)
          .then(async () => {
            io.emit('broadcastList', await getBroadcastList());

            // Publish viewer count change to System-Manager
            try {
              const stored = await redisClient.getBroadcast(roomId);
              await redisClient.publish('broadcast:viewer-count', JSON.stringify({
                roomId,
                viewerCount: stored?.viewerCount ?? 0
              }));
            } catch (err) {
              log.warn('Failed to publish viewer count to Redis:', err.message);
            }
          })
          .catch((err) => log.warn(`Failed to decrement viewer count for ${roomId} on leave:`, err.message));
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      log.info(`Client disconnected: ${socket.id}`);

      broadcasts.forEach((broadcast, roomId) => {
        if (broadcast.broadcasterId === socket.id) {
          // Start grace window — keep the broadcast alive for 30s so the teacher
          // can reconnect (e.g. browser refresh) without evicting all students.
          const res = socketResources.get(socket.id);
          const savedResources = {
            producerTransport: res?.producerTransport ?? null,
            producers: [...(res?.producers ?? [])],
          };
          // Detach from socketResources so they’re not force-closed below
          if (res) { res.producerTransport = null; res.producers = []; }

          const timer = setTimeout(() => {
            broadcasterGraceTimers.delete(roomId);
            savedResources.producers.forEach((p) => { try { p.close(); } catch (_) {} });
            try { savedResources.producerTransport?.close(); } catch (_) {}
            cleanupBroadcast(roomId, socket.id);
          }, 30_000);
          broadcasterGraceTimers.set(roomId, { timer, lostSocketId: socket.id, savedResources });
          log.info(`Broadcaster disconnected from ${roomId}, 30s grace window started`);
        } else if (broadcast.viewers?.has(socket.id)) {
          const viewer = broadcast.viewers.get(socket.id);
          viewer?.consumers.forEach((c) => { try { c.close(); } catch (_) {} });
          broadcast.viewers.delete(socket.id);

          const res = socketResources.get(socket.id);
          if (res?.viewerCounted) {
            res.viewerCounted = false;
            redisClient.updateBroadcastViewerCount(roomId, -1)
              .then(async () => {
                io.emit('broadcastList', await getBroadcastList());

                // Publish viewer count change to System-Manager
                try {
                  const stored = await redisClient.getBroadcast(roomId);
                  await redisClient.publish('broadcast:viewer-count', JSON.stringify({
                    roomId,
                    viewerCount: stored?.viewerCount ?? 0
                  }));
                } catch (err) {
                  log.warn('Failed to publish viewer count to Redis:', err.message);
                }
              })
              .catch((err) => log.warn(`Failed to decrement viewer count for ${roomId} on disconnect:`, err.message));
          }
        }
      });

      const res = socketResources.get(socket.id);
      if (res) {
        res.consumers.forEach((c) => { try { c.close(); } catch (_) {} });
        res.producers.forEach((p) => { try { p.close(); } catch (_) {} });
        try { res.consumerTransport?.close(); } catch (_) {}
        try { res.producerTransport?.close(); } catch (_) {}
      }
      socketResources.delete(socket.id);
    });
  });
}
