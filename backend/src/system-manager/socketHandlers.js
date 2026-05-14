/**
 * Socket.IO Handlers (System-Manager)
 *
 * Listens to Redis pub/sub for:
 * - broadcast:list-updated → notify all users
 * - broadcast:viewer-count → notify all users about viewer updates
 * - recording:status → notify about recording state
 * - recording:progress → notify about recording upload progress
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('socket:handlers');

export function registerSocketHandlers(io, redisClient) {
  /**
   * Create a dedicated subscriber for pub/sub (separate from main client)
   */
  let pubsubSubscriber = null;

  const setupPubSub = async () => {
    try {
      pubsubSubscriber = redisClient.client.duplicate();
      await pubsubSubscriber.connect();

      // Subscribe to all recording and broadcast channels
      await pubsubSubscriber.subscribe(
        ['broadcast:list-updated', 'broadcast:viewer-count', 'recording:status', 'recording:progress'],
        (message, channel) => {
          try {
            const data = JSON.parse(message);

            // Target room-scoped events at clients who joined `room:${roomId}` via
            // the `broadcast:join-room` handler below, instead of fanning out to
            // every connected socket. With many active classrooms this would
            // otherwise be O(clients × events).

            // broadcast:list-updated — classroom-scoped (clients on the dashboard
            // for that classroom). Falls back to global if classroomId is missing.
            if (channel === 'broadcast:list-updated') {
              log.info(`📡 Broadcast list updated: ${data.roomId} (${data.action})`);
              const payload = {
                roomId: data.roomId,
                classroomId: data.classroomId,
                action: data.action,
                timestamp: data.timestamp || Date.now(),
              };
              if (data.classroomId) {
                io.to(`classroom:${data.classroomId}`).emit('broadcast:list-updated', payload);
              } else {
                io.emit('broadcast:list-updated', payload);
              }
            }

            // broadcast:viewer-count — only clients watching that broadcast
            if (channel === 'broadcast:viewer-count' && data.roomId) {
              log.debug(`📊 Viewer count: ${data.roomId} = ${data.viewerCount}`);
              io.to(`room:${data.roomId}`).emit('broadcast:viewer-count', {
                roomId: data.roomId,
                count: data.viewerCount,
                timestamp: data.timestamp || Date.now(),
              });
            }

            // recording:status — only clients watching that broadcast
            if (channel === 'recording:status' && data.roomId) {
              log.info(`📹 Recording status: ${data.recordingId} → ${data.status}`);
              io.to(`room:${data.roomId}`).emit('recording:status', {
                recordingId: data.recordingId,
                roomId: data.roomId,
                status: data.status,
                duration: data.duration,
                fileSize: data.fileSize,
                reason: data.reason,
                timestamp: data.timestamp || Date.now(),
              });
            }

            // recording:progress — only clients watching that broadcast
            if (channel === 'recording:progress' && data.roomId) {
              log.debug(`📤 Recording progress: ${data.recordingId} → ${data.uploadedBytes} bytes`);
              io.to(`room:${data.roomId}`).emit('recording:progress', {
                recordingId: data.recordingId,
                roomId: data.roomId,
                uploadedBytes: data.uploadedBytes,
                timestamp: data.timestamp || Date.now(),
              });
            }
          } catch (err) {
            log.error(`Error parsing pub/sub message on ${channel}:`, err);
          }
        }
      );

      log.info('✅ System-Manager subscribed to Redis pub/sub channels');
    } catch (err) {
      log.error('Failed to setup pub/sub:', err);
    }
  };

  // Initialize pub/sub asynchronously
  setupPubSub();

  /**
   * Socket.IO connection handler
   */
  io.on('connection', (socket) => {
    const userId = socket.handshake.auth?.userId || 'anonymous';
    log.info(`✅ Client connected: ${socket.id} (user: ${userId})`);

    // Client requests to join a "broadcast room" (for targeted updates)
    socket.on('broadcast:join-room', ({ roomId, classroomId }) => {
      if (!roomId) return;

      socket.join(`room:${roomId}`);
      log.debug(`Client ${socket.id} joined room:${roomId}`);

      // Send current viewer count immediately
      (async () => {
        try {
          const broadcast = await redisClient.getBroadcast(roomId);
          if (broadcast) {
            socket.emit('broadcast:viewer-count', {
              roomId,
              count: broadcast.viewerCount || 0,
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
    socket.on('broadcast:list-request', async ({ classroomId }) => {
      if (!classroomId) return;

      try {
        const allBroadcasts = await redisClient.getAllBroadcasts();
        const broadcasts = allBroadcasts
          .filter(b => b.status === 'active')
          .map(b => ({
            roomId: b.roomId,
            viewerCount: b.viewerCount || 0,
          }));

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
      log.debug(`Client disconnected: ${socket.id}`);
    });
  });

  // Return shutdown function
  return {
    shutdown: async () => {
      if (pubsubSubscriber) {
        try {
          await pubsubSubscriber.unsubscribe();
          await pubsubSubscriber.quit();
          log.info('Pub/sub subscriber closed');
        } catch (err) {
          log.warn('Error closing pub/sub subscriber:', err.message);
        }
      }
    },
  };
}

export default registerSocketHandlers;
