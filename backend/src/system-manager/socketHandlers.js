/**
 * Socket.IO Handlers (System-Manager)
 *
 * Listens to Redis pub/sub for:
 * - broadcast:list-updated → notify all users
 * - broadcast:viewer-count → notify all users about viewer updates
 * - recording:status → notify about recording state
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('socket:handlers');

export function registerSocketHandlers(io, redisClient) {
  /**
   * Redis pub/sub subscriber for broadcast updates
   * Use the existing subscriber from RedisClient
   */
  const pubsub = redisClient.subscriber;
  
  pubsub.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);

      // broadcast:list-updated
      // Origin server publishes when: broadcast created/ended
      if (channel === 'broadcast:list-updated') {
        log.info(`📡 [SYSTEM-MANAGER] Received broadcast:list-updated from ORIGIN → Forwarding to frontend: ${data.roomId} (${data.action})`);
        io.emit('broadcast:list-updated', {
          roomId: data.roomId,
          classroomId: data.classroomId,
          action: data.action, // 'created' | 'ended'
          timestamp: data.timestamp,
        });
      }

      // broadcast:viewer-count
      // Origin server publishes when: viewer joins/leaves
      if (channel === 'broadcast:viewer-count') {
        log.info(`📡 [SYSTEM-MANAGER] Received broadcast:viewer-count from ORIGIN → Forwarding to frontend: room ${data.roomId}, count ${data.count}`);
        io.emit('broadcast:viewer-count', {
          roomId: data.roomId,
          count: data.count,
          timestamp: data.timestamp,
        });
      }

      // recording:status
      // Origin/Edge publishes when: recording starts/stops/fails
      if (channel === 'recording:status') {
        log.info(`📡 [SYSTEM-MANAGER] Received recording:status from ORIGIN → Forwarding to frontend: ${data.recordingId}, status ${data.status}`);
        io.emit('recording:status', {
          recordingId: data.recordingId,
          roomId: data.roomId,
          status: data.status, // 'started' | 'stopped' | 'processing' | 'ready' | 'failed'
          progress: data.progress,
          timestamp: data.timestamp,
        });
      }
    } catch (err) {
      log.error(`Error parsing pub/sub message on ${channel}:`, err);
    }
  });

  pubsub.subscribe(
    'broadcast:list-updated',
    'broadcast:viewer-count',
    'recording:status',
    (err) => {
      if (err) {
        log.error('Failed to subscribe to pub/sub channels:', err);
      } else {
        log.info('✅ System-Manager subscribed to broadcast updates');
      }
    }
  );

  /**
   * Socket.IO connection handler
   */
  io.on('connection', (socket) => {
    const userId = socket.handshake.auth?.userId || 'anonymous';
    log.info(`✅ [SYSTEM-MANAGER] Socket.IO client connected via SYSTEM-MANAGER: ${socket.id} (user: ${userId})`);

    // Client requests to join a "broadcast room" (for targeted updates)
    // broadcast:join-room { roomId, classroomId }
    socket.on('broadcast:join-room', ({ roomId, classroomId }) => {
      if (!roomId) return;

      socket.join(`room:${roomId}`);
      log.info(`📡 [SYSTEM-MANAGER] Client joined broadcast room: ${roomId} (classroom: ${classroomId}), socket: ${socket.id}`);
      log.debug(`Client ${socket.id} joined room:${roomId}`);

      // Send current viewer count immediately
      (async () => {
        try {
          const edgeKey = `broadcast:${roomId}:edge`;
          const edgeData = await redisClient.get(edgeKey);
          if (edgeData) {
            const edge = JSON.parse(edgeData);
            socket.emit('broadcast:viewer-count', {
              roomId,
              count: edge.currentViewers || 0,
            });
          }
        } catch (err) {
          log.error(`Error fetching viewer count for ${roomId}:`, err);
        }
      })();
    });

    // Client leaves broadcast room
    socket.on('broadcast:leave-room', ({ roomId }) => {
      if (!roomId) return;
      socket.leave(`room:${roomId}`);
      log.debug(`Client ${socket.id} left room:${roomId}`);
    });

    // Request current broadcast list for a classroom
    // broadcast:list-request { classroomId }
    socket.on('broadcast:list-request', async ({ classroomId }) => {
      if (!classroomId) return;

      try {
        const broadcastKeys = await redisClient.keys(`broadcast:*:edge`);
        const broadcasts = [];

        for (const key of broadcastKeys) {
          const edgeData = await redisClient.get(key);
          const roomId = key.split(':')[1];

          if (edgeData) {
            const edge = JSON.parse(edgeData);
            // TODO: Verify this room belongs to classroomId
            broadcasts.push({
              roomId,
              viewerCount: edge.currentViewers || 0,
              serverId: edge.serverId,
            });
          }
        }

        socket.emit('broadcast:list-response', {
          classroomId,
          broadcasts,
        });
      } catch (err) {
        log.error(`Error fetching broadcast list for ${classroomId}:`, err);
        socket.emit('error', 'Failed to fetch broadcast list');
      }
    });

    socket.on('disconnect', () => {
      log.info(`✅ [SYSTEM-MANAGER] Client disconnected from SYSTEM-MANAGER: ${socket.id}`);
    });
  });

  // Graceful shutdown
  return {
    shutdown: async () => {
      await pubsub.unsubscribe();
      await pubsub.quit();
      log.info('pub/sub connections closed');
    },
  };
}

export default registerSocketHandlers;
