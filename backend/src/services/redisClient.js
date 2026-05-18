/**
 * Redis Client – Centralized Redis operations
 * Handles: Edge health tracking, load balancing data, broadcast management,
 * user sessions, and monitoring statistics.
 * 
 * Supports both local Redis and Upstash (TLS) connections.
 * - Local: redis://localhost:6379
 * - Upstash: rediss://default:PASSWORD@hostname.upstash.io:6379
 */

import redis from 'redis';
import { createLogger } from '../utils/logger.js';

const log = createLogger('redis');

// Channel name constants — MUST stay in sync with ai-service/app/redis_client.py.
// Any change here must be mirrored there in the same commit.
export const CHANNEL_TRANSCRIPTION_CONTROL = 'transcription:control';   // start|stop lifecycle
export const CHANNEL_TRANSCRIPTION_CHUNK = 'transcription:chunk';       // streamed transcript text (UI)
export const CHANNEL_CHAT_MESSAGE = 'chat:message';
export const CHANNEL_CHAT_STATUS = 'chat:status-update';

export class RedisClient {
  constructor() {
    this.client = null;
    this.subscriber = null;
  }

  // Connection

  async connect(redisUrl = 'redis://localhost:6379') {
    // Detect TLS from URL scheme (rediss://)
    const useTls = redisUrl.startsWith('rediss://');
    
    const clientConfig = {
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          log.warn(`Reconnect attempt ${retries}`);
          if (retries > 10) {
            log.error('Reconnection failed after 10 attempts');
            return new Error('Redis reconnection failed');
          }
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 10000,
      },
    };

    // Enable TLS for Upstash (rediss://)
    if (useTls) {
      clientConfig.socket.tls = true;
      log.info('TLS enabled for Redis connection (Upstash)');
    }

    this.client = redis.createClient(clientConfig);
    this.subscriber = this.client.duplicate();

    // Error handlers for BOTH client and subscriber to prevent crashes
    this.client.on('error', (err) => log.error('Client error:', err.message));
    this.client.on('connect', () => log.info('Connected'));
    this.client.on('reconnecting', () => log.warn('Reconnecting...'));

    this.subscriber.on('error', (err) => log.error('Subscriber error:', err.message));
    this.subscriber.on('connect', () => log.info('Subscriber connected'));
    this.subscriber.on('reconnecting', () => log.warn('Subscriber reconnecting...'));

    await this.client.connect();
    await this.subscriber.connect();
    log.info(`Initialized successfully (TLS: ${useTls})`);
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      log.info('Client disconnected');
    }
    if (this.subscriber) {
      await this.subscriber.quit();
      log.info('Subscriber disconnected');
    }
  }

  // Edge Server Management

  async registerEdge(edgeInfo) {
    const {
      ip,
      port,
      serverId,
      internalHost,
      internalPort,
      maxCapacity = 200,
      region = 'UNKNOWN',
    } = edgeInfo;

    const key = `edge:${serverId}`;
    const value = JSON.stringify({
      ip,
      port,
      serverId,
      internalHost,
      internalPort,
      region,
      maxCapacity,
      userCount: 0,
      isAlive: true,
      lastHeartbeat: Date.now(),
      registeredAt: Date.now(),
    });

    await this.client.setEx(key, 30, value);
    // Track membership in a set so getAllEdges can avoid an O(N) KEYS scan.
    // Stale members (edge crashed without removeEdge) are reaped lazily by
    // getAllEdges when the underlying edge:<id> key has expired.
    await this.client.sAdd('edges:active', serverId);
    log.info(`Edge registered: ${serverId} (ext=${ip}:${port}, int=${internalHost}:${internalPort})`);
    return key;
  }

  async updateEdgeHeartbeat(serverId, userCount, metrics = {}) {
    const key = `edge:${serverId}`;
    const data = await this.client.get(key);
    if (!data) {
      log.warn(`Edge ${serverId} not found`);
      return null;
    }

    const edge = JSON.parse(data);
    edge.userCount = userCount;
    edge.lastHeartbeat = Date.now();
    edge.loadPercentage = (userCount / edge.maxCapacity) * 100;
    if (metrics.cpuUsage !== undefined) edge.cpuUsage = metrics.cpuUsage;
    if (metrics.memoryUsage !== undefined) edge.memoryUsage = metrics.memoryUsage;

    await this.client.setEx(key, 30, JSON.stringify(edge));
    return edge;
  }

  async getAllEdges() {
    const serverIds = await this.client.sMembers('edges:active');
    if (!serverIds?.length) return [];

    const keys = serverIds.map((id) => `edge:${id}`);
    const values = await this.client.mGet(keys);

    const stale = [];
    const edges = [];
    for (let i = 0; i < serverIds.length; i++) {
      const data = values[i];
      if (!data) {
        // Underlying edge:<id> key expired — reap from the set lazily.
        stale.push(serverIds[i]);
        continue;
      }
      try {
        const edge = JSON.parse(data);
        if (edge?.isAlive) edges.push(edge);
      } catch {
        stale.push(serverIds[i]);
      }
    }

    if (stale.length) {
      // Best-effort cleanup; failures here just mean we'll retry next call.
      this.client.sRem('edges:active', stale).catch(() => {});
    }

    return edges;
  }

  async removeEdge(serverId) {
    const key = `edge:${serverId}`;
    await this.client.del(key);
    await this.client.sRem('edges:active', serverId).catch(() => {});
    log.info(`Edge removed: ${serverId}`);
  }

  // Broadcast Management

  async registerBroadcast(roomId, info) {
    const key = `broadcast:${roomId}`;
    const value = JSON.stringify({
      roomId,
      originServer: info.originServer,
      producerId: info.producerId,
      edgeServers: info.edgeServers || [],
      viewerCount: 0,
      maxViewers: info.maxViewers || 500,
      startTime: Date.now(),
      status: 'active',
    });

    await this.client.set(key, value);
    // Track active broadcasts in a set for O(1) membership / O(M) listing,
    // avoiding KEYS scans of the entire keyspace in getAllBroadcasts.
    await this.client.sAdd('broadcasts:active', roomId);
    // Reset viewer counter so a re-registered broadcast doesn't inherit stale data.
    await this.client.set(this._viewerCounterKey(roomId), '0');
    log.info(`Broadcast registered: ${roomId}`);
    return key;
  }

  // Viewer counter lives in its own key so concurrent increments/decrements
  // across many origin/edge processes are atomic via INCRBY, instead of the
  // previous read-modify-write on a JSON blob (which could lose updates under
  // contention).
  _viewerCounterKey(roomId) {
    return `broadcast:${roomId}:viewers`;
  }

  async updateBroadcastViewerCount(roomId, delta) {
    // Ensure the broadcast still exists — if not, don't create a stray counter.
    const exists = await this.client.exists(`broadcast:${roomId}`);
    if (!exists) return null;

    let next = await this.client.incrBy(this._viewerCounterKey(roomId), delta);
    if (next < 0) {
      // Defensive: viewer counts must be non-negative. Most likely we logged
      // a decrement for a join that never completed (Redis blip during the +1).
      await this.client.set(this._viewerCounterKey(roomId), '0');
      next = 0;
    }
    await this.client.publish('broadcast:viewerCount', JSON.stringify({ roomId, viewerCount: next }));
    return next;
  }

  async subscribeToViewerCount(callback) {
    await this.subscriber.subscribe('broadcast:viewerCount', (message) => {
      try {
        callback?.(JSON.parse(message));
      } catch {
        // ignore malformed pub/sub messages
      }
    });
  }

  async getBroadcast(roomId) {
    const data = await this.client.get(`broadcast:${roomId}`);
    if (!data) return null;
    const broadcast = JSON.parse(data);
    // Merge in the live counter — viewerCount lives in its own key for atomicity.
    const counter = await this.client.get(this._viewerCounterKey(roomId));
    broadcast.viewerCount = Math.max(0, parseInt(counter, 10) || 0);
    return broadcast;
  }

  async addEdgeToBroadcast(roomId, edgeServerId) {
    const key = `broadcast:${roomId}`;
    const data = await this.client.get(key);
    if (!data) {
      log.warn(`Broadcast ${roomId} not found`);
      return null;
    }

    const broadcast = JSON.parse(data);
    if (!broadcast.edgeServers) broadcast.edgeServers = [];
    if (!broadcast.edgeServers.includes(edgeServerId)) {
      broadcast.edgeServers.push(edgeServerId);
      await this.client.set(key, JSON.stringify(broadcast));
      log.info(`Edge ${edgeServerId} added to broadcast ${roomId}`);
    }
    return broadcast;
  }

  async endBroadcast(roomId) {
    const key = `broadcast:${roomId}`;
    const data = await this.client.get(key);
    if (!data) return null;

    const broadcast = JSON.parse(data);
    broadcast.status = 'ended';
    broadcast.endTime = Date.now();

    await this.client.set(key, JSON.stringify(broadcast));
    // Drop from active set so getAllBroadcasts won't return ended broadcasts.
    await this.client.sRem('broadcasts:active', roomId).catch(() => {});
    // Tear down the viewer counter — leaving it would let the next registerBroadcast
    // be reset cleanly, but we'd be paying for a stale key in the meantime.
    await this.client.del(this._viewerCounterKey(roomId)).catch(() => {});
    log.info(`Broadcast ended: ${roomId}`);
    return broadcast;
  }

  async getAllBroadcasts() {
    const roomIds = await this.client.sMembers('broadcasts:active');
    if (!roomIds?.length) return [];

    const broadcastKeys = roomIds.map((id) => `broadcast:${id}`);
    const counterKeys = roomIds.map((id) => this._viewerCounterKey(id));
    // Two MGETs, run in parallel — still O(M) round-trips, no keyspace scan.
    const [broadcastVals, counterVals] = await Promise.all([
      this.client.mGet(broadcastKeys),
      this.client.mGet(counterKeys),
    ]);

    const stale = [];
    const broadcasts = [];
    for (let i = 0; i < roomIds.length; i++) {
      const data = broadcastVals[i];
      if (!data) { stale.push(roomIds[i]); continue; }
      try {
        const b = JSON.parse(data);
        if (b?.status === 'active') {
          b.viewerCount = Math.max(0, parseInt(counterVals[i], 10) || 0);
          broadcasts.push(b);
        } else {
          stale.push(roomIds[i]);
        }
      } catch {
        stale.push(roomIds[i]);
      }
    }

    if (stale.length) {
      this.client.sRem('broadcasts:active', stale).catch(() => {});
    }

    return broadcasts;
  }

  // Statistics

  async getStats() {
    const info = await this.client.info();
    const edges = await this.getAllEdges();
    const broadcasts = await this.getAllBroadcasts();

    return {
      timestamp: Date.now(),
      edges: {
        total: edges.length,
        totalCapacity: edges.reduce((s, e) => s + e.maxCapacity, 0),
        totalUsers: edges.reduce((s, e) => s + e.userCount, 0),
        averageLoad:
          edges.length > 0
            ? `${(edges.reduce((s, e) => s + (e.loadPercentage || 0), 0) / edges.length).toFixed(2)}%`
            : '0%',
      },
      broadcasts: {
        active: broadcasts.length,
        totalViewers: broadcasts.reduce((s, b) => s + b.viewerCount, 0),
      },
      redis: {
        connected: true,
        memory: info.split('used_memory_human:')[1]?.split('\r')[0] || 'N/A',
      },
    };
  }

  // Generic Redis operations (for direct access to client)

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, options = {}) {
    return this.client.set(key, value, options);
  }

  async keys(pattern) {
    return this.client.keys(pattern);
  }

  async del(key) {
    return this.client.del(key);
  }

  async exists(key) {
    return this.client.exists(key);
  }

  // Pub/Sub

  async subscribeToExpiration(callback) {
    await this.subscriber.pSubscribe('__keyevent@0__:expired', (message) => {
      log.warn(`Key expired: ${message}`);
      callback?.(message);
    });
    log.info('Subscribed to key expiration events');
  }

  /**
   * Publish a message to a Redis channel
   * @param {string} channel - Channel name
   * @param {string} message - Message to publish (will be stringified if object)
   */
  async publish(channel, message) {
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    return this.client.publish(channel, msg);
  }

  /**
   * Subscribe to a Redis channel with a callback
   * @param {string} channel - Channel name
   * @param {Function} callback - Callback function (receives parsed message)
   */
  async subscribe(channel, callback) {
    await this.subscriber.subscribe(channel, (message) => {
      try {
        const parsed = JSON.parse(message);
        callback?.(parsed);
      } catch {
        callback?.(message);
      }
    });
    log.info(`Subscribed to channel: ${channel}`);
  }
}

export default RedisClient;
