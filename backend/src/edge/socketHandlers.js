import { createLogger } from '../utils/logger.js';

const log = createLogger('edge:socket');

/**
 * @param {object}  deps  
 * @param {object}  deps.io         – Socket.IO server
 * @param {object}  deps.config
 * @param {object}  deps.edgeState  – shared edge state
 */
export function registerEdgeSocketHandlers({ io, config, edgeState, redisClient }) {
  const socketResources = new Map();

  io.on('connection', (socket) => {
    log.info(`Student connected: ${socket.id}`);
    edgeState.connectedStudents++;

    socketResources.set(socket.id, {
      consumerTransport: null,
      consumers: [],
      roomId: null,
      viewerCounted: false,
    });

    // Capabilities
    socket.on('getRouterRtpCapabilities', (cb) => {
      cb(edgeState.rtpCapabilities);
    });

    // Join Broadcast
    socket.on('joinBroadcast', async ({ roomId }, cb) => {
      try {
        const broadcast = edgeState.broadcasts.get(roomId);
        if (!broadcast) return cb({ error: 'Broadcast not found on this edge server' });
        if (broadcast.virtualProducers.size === 0) return cb({ error: 'Broadcast not ready yet (no producers)' });

        const res = socketResources.get(socket.id);
        res.roomId = roomId;
        res.viewerCounted = true;
        await redisClient.updateBroadcastViewerCount(roomId, 1);

        log.info(`Student ${socket.id} joined room ${roomId}`);
        cb({ success: true });
      } catch (err) {
        log.error('Error joining broadcast:', err);
        cb({ error: err.message });
      }
    });

    // Create Consumer Transport
    socket.on('createWebRtcTransport', async ({ sender, roomId }, cb) => {
      try {
        if (sender) return cb({ error: 'Edge servers do not accept producers' });

        const transport = await edgeState.mainRouter.createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: config.announcedIp }],
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
      } catch (err) {
        log.error('Error creating transport:', err);
        cb({ error: err.message });
      }
    });

    // Connect Transport
    socket.on('connectTransport', async ({ transportId, dtlsParameters }, cb) => {
      try {
        const transport = socketResources.get(socket.id)?.consumerTransport;
        if (!transport || transport.id !== transportId) return cb({ error: 'Transport not found' });

        await transport.connect({ dtlsParameters });
        log.info(`Student transport connected: ${socket.id}`);
        cb({ success: true });
      } catch (err) {
        log.error('Error connecting transport:', err);
        cb({ error: err.message });
      }
    });

    // Consume
    socket.on('consume', async ({ roomId, rtpCapabilities, kind }, cb) => {
      try {
        const res = socketResources.get(socket.id);
        if (!res?.consumerTransport) return cb({ error: 'Consumer transport not found' });

        const broadcast = edgeState.broadcasts.get(roomId);
        if (!broadcast) return cb({ error: 'Broadcast not found on this edge' });

        const virtualProducer = broadcast.virtualProducers.get(kind);
        if (!virtualProducer) return cb({ error: `No ${kind} producer in this broadcast` });

        if (!edgeState.mainRouter.canConsume({ producerId: virtualProducer.id, rtpCapabilities })) {
          return cb({ error: 'Cannot consume this producer' });
        }

        const consumer = await res.consumerTransport.consume({
          producerId: virtualProducer.id,
          rtpCapabilities,
          paused: true,
        });

        res.consumers.push(consumer);
        consumer.on('producerclose', () => socket.emit('producerClosed', { kind }));

        log.info(`Consumer created (paused) – Room: ${roomId}, Kind: ${kind}, Student: ${socket.id}`);

        cb({
          id: consumer.id,
          producerId: virtualProducer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          simulcast: kind === 'video',
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

    // Set Quality (simulcast layer)
    socket.on('setQuality', async ({ roomId, quality }, cb) => {
      try {
        const videoConsumer = socketResources.get(socket.id)?.consumers.find((c) => c.kind === 'video');
        if (!videoConsumer) return cb({ error: 'Video consumer not found' });

        const layerMap = { low: 0, medium: 1, high: 2, auto: -1 };
        const spatialLayer = layerMap[quality];

        if (spatialLayer === undefined || spatialLayer === -1) {
          await videoConsumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
        } else {
          await videoConsumer.setPreferredLayers({ spatialLayer, temporalLayer: 2 });
        }

        log.info(`Student ${socket.id} quality → ${quality}`);
        cb({ success: true });
      } catch (err) {
        log.error('Error setting quality:', err);
        cb({ error: err.message });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      log.info(`Student disconnected: ${socket.id}`);
      edgeState.connectedStudents--;

      const res = socketResources.get(socket.id);
      if (res) {
        if (res.viewerCounted && res.roomId) {
          redisClient.updateBroadcastViewerCount(res.roomId, -1)
            .catch(() => {});
          res.viewerCounted = false;
        }
        res.consumers.forEach((c) => { try { c.close(); } catch (_) {} });
        try { res.consumerTransport?.close(); } catch (_) {}
      }
      socketResources.delete(socket.id);
    });
  });
}
