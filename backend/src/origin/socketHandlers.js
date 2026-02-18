/**
 * Origin Socket.IO handlers
 * Handles: broadcaster transports, producing, consuming (fallback),
 * broadcast lifecycle, and piping triggers.
 */

import { mediaCodecs } from '../config/mediaCodecs.js';
import { createLogger } from '../utils/logger.js';
import { connectEdgeServers, cleanupPipes } from './pipeManager.js';

const log = createLogger('origin:socket');

/**
 * @param {object}  deps
 * @param {object}  deps.io           – Socket.IO server
 * @param {object}  deps.config
 * @param {object}  deps.redisClient
 * @param {Map}     deps.broadcasts   – shared originBroadcasts map
 * @param {object}  deps.state        – { rtpCapabilities, containerIp }
 * @param {Function} deps.getNextWorker
 */
export function registerOriginSocketHandlers({ io, config, redisClient, broadcasts, state, getNextWorker }) {
  /** Helper: build broadcast list for clients */
  function getBroadcastList() {
    return Array.from(broadcasts.entries()).map(([roomId, b]) => ({
      roomId,
      viewerCount: 0,
      hasVideo: b.producers.has('video'),
      hasAudio: b.producers.has('audio'),
    }));
  }

  /** Cleanup a broadcast and all its resources */
  async function cleanupBroadcast(roomId, broadcasterId) {
    const broadcast = broadcasts.get(roomId);
    if (!broadcast || broadcast.broadcasterId !== broadcasterId) return;

    log.info(`Cleaning up broadcast: ${roomId}`);
    if (broadcast.pipeTimer) clearTimeout(broadcast.pipeTimer);

    await cleanupPipes(broadcast);

    broadcast.producers.forEach((p) => { try { p.close(); } catch (_) {} });
    try { broadcast.router.close(); } catch (_) {}

    broadcasts.delete(roomId);
    await redisClient.endBroadcast(roomId);

    log.info(`Broadcast cleaned up: ${roomId}`);
    io.emit('broadcastList', getBroadcastList());
  }

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
    });

    // Capabilities
    socket.on('getRouterRtpCapabilities', (cb) => cb(state.rtpCapabilities));

    // Broadcast List
    socket.on('getBroadcasts', (cb) => cb(getBroadcastList()));

    // Create Transport
    socket.on('createWebRtcTransport', async ({ sender, roomId }, cb) => {
      try {
        let broadcast = broadcasts.get(roomId);

        if (sender) {
          if (broadcast?.broadcasterId && broadcast.broadcasterId !== socket.id) {
            return cb({ error: `Room "${roomId}" already has a broadcaster` });
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
        io.emit('broadcastList', getBroadcastList());
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

        socketResources.get(socket.id).roomId = roomId;
        log.info(`Fallback viewer ${socket.id} joined ${roomId} (${broadcast.viewers.size} viewers)`);
        cb({ success: true });
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
    });

    // Disconnect
    socket.on('disconnect', () => {
      log.info(`Client disconnected: ${socket.id}`);

      broadcasts.forEach((broadcast, roomId) => {
        if (broadcast.broadcasterId === socket.id) {
          cleanupBroadcast(roomId, socket.id);
        } else if (broadcast.viewers?.has(socket.id)) {
          const viewer = broadcast.viewers.get(socket.id);
          viewer?.consumers.forEach((c) => { try { c.close(); } catch (_) {} });
          broadcast.viewers.delete(socket.id);
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
