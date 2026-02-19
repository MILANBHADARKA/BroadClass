/**
 * Redis Client – Centralized Redis operations
 * Handles: Edge health tracking, load balancing data, broadcast management,
 * user sessions, and monitoring statistics.
 */

import redis from 'redis';
import { createLogger } from '../utils/logger.js';

const log = createLogger('redis');

export class RedisClient {
  constructor() {
    this.client = null;
    this.subscriber = null;
  }

  // Connection

  async connect(redisUrl = 'redis://localhost:6379') {
    this.client = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          log.warn(`Reconnect attempt ${retries}`);
          if (retries > 10) {
            log.error('Reconnection failed after 10 attempts');
            return new Error('Redis reconnection failed');
          }
          return Math.min(retries * 50, 500);
        },
      },
    });

    this.subscriber = this.client.duplicate();

    this.client.on('error', (err) => log.error('Client error:', err));
    this.client.on('connect', () => log.info('Connected'));

    await this.client.connect();
    await this.subscriber.connect();
    log.info('Initialized successfully');
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
    log.info(`Edge registered: ${serverId} (ext=${ip}:${port}, int=${internalHost}:${internalPort})`);
    return key;
  }

  async updateEdgeHeartbeat(serverId, userCount) {
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

    await this.client.setEx(key, 30, JSON.stringify(edge));
    return edge;
  }

  async getAllEdges() {
    const keys = await this.client.keys('edge:*');
    if (!keys?.length) return [];

    const edges = await Promise.all(
      keys.map(async (key) => {
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
      }),
    );
    return edges.filter((e) => e?.isAlive);
  }

  async removeEdge(serverId) {
    const key = `edge:${serverId}`;
    await this.client.del(key);
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
    log.info(`Broadcast registered: ${roomId}`);
    return key;
  }

  async updateBroadcastViewerCount(roomId, delta) {
    const key = `broadcast:${roomId}`;
    const data = await this.client.get(key);
    if (!data) return null;

    const broadcast = JSON.parse(data);
    const current = broadcast.viewerCount || 0;
    const next = Math.max(0, current + delta);
    broadcast.viewerCount = next;

    await this.client.set(key, JSON.stringify(broadcast));
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
    return data ? JSON.parse(data) : null;
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
    log.info(`Broadcast ended: ${roomId}`);
    return broadcast;
  }

  async getAllBroadcasts() {
    const keys = await this.client.keys('broadcast:*');
    if (!keys?.length) return [];

    const broadcasts = await Promise.all(
      keys.map(async (key) => {
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
      }),
    );
    return broadcasts.filter((b) => b?.status === 'active');
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

  // Pub/Sub

  async subscribeToExpiration(callback) {
    await this.subscriber.pSubscribe('__keyevent@0__:expired', (message) => {
      log.warn(`Key expired: ${message}`);
      callback?.(message);
    });
    log.info('Subscribed to key expiration events');
  }
}

export default RedisClient;
