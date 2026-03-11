/**
 * Edge Proxy Middleware
 *
 * Proxies Socket.IO polling requests from viewers through the origin to the
 * correct edge server's internal (VPC-private) IP.
 *
 * Route: /edge/:serverId/socket.io/...
 *   → http://<edge.internalHost>:<edge.internalPort>/socket.io/...
 *
 * Why needed:
 *   - Edge servers run plain HTTP on port 3002 (no TLS)
 *   - Browsers block mixed-content (HTTP WebSocket from HTTPS page)
 *   - The origin is behind the ALB which terminates TLS, so proxying through
 *     origin provides HTTPS for the viewer while forwarding on VPC-internally
 *
 * Transport notes:
 *   - HTTP polling requests are fully handled here
 *   - WebSocket upgrade attempts hit origin's Socket.IO (wrong path → 400),
 *     causing the client to gracefully fall back to polling — which works here
 *   - The actual media (video/audio) flows via WebRTC UDP directly and is
 *     unaffected by this HTTP signaling proxy
 */

import http from 'http';
import { createLogger } from '../utils/logger.js';

const log = createLogger('edge-proxy');

/**
 * @param {import('express').Express} app
 * @param {import('../services/redisClient.js').RedisClient} redisClient
 * @param {Map<string, {internalHost: string, internalPort: number}>} edgeRegistry
 *   In-memory cache populated by register/heartbeat routes for fast sync lookups
 */
export function setupEdgeProxy(app, redisClient, edgeRegistry) {
  app.use('/edge/:serverId', async (req, res) => {
    const { serverId } = req.params;

    // Fast in-memory lookup first; fall back to Redis for cold-cache misses
    let edge = edgeRegistry.get(serverId);
    if (!edge) {
      try {
        const edges = await redisClient.getAllEdges();
        edge = edges.find((e) => e.serverId === serverId);
        if (edge) {
          edgeRegistry.set(serverId, {
            internalHost: edge.internalHost,
            internalPort: edge.internalPort || 3002,
          });
        }
      } catch (err) {
        log.error('Redis lookup failed for edge proxy:', err.message);
      }
    }

    if (!edge) {
      log.warn(`Edge proxy: serverId not found: ${serverId}`);
      return res.status(404).json({ error: 'Edge not found' });
    }

    const targetHost = edge.internalHost;
    const targetPort = edge.internalPort || 3002;

    // req.url inside app.use('/edge/:serverId', ...) is the path AFTER stripping
    // /edge/:serverId — so it becomes /socket.io/?EIO=4&... which is exactly
    // what the edge's Socket.IO server expects
    const targetPath = req.url || '/socket.io/';

    const options = {
      hostname: targetHost,
      port: targetPort,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${targetHost}:${targetPort}`,
      },
    };

    log.debug(`Proxy ${req.method} → ${targetHost}:${targetPort}${targetPath}`);

    const proxy = http.request(options, (proxyRes) => {
      // Strip CORS headers from edge response — origin middleware already sets them
      const headers = Object.fromEntries(
        Object.entries(proxyRes.headers).filter(([k]) => {
          const lk = k.toLowerCase();
          return !lk.startsWith('access-control-');
        }),
      );
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res, { end: true });
    });

    proxy.on('error', (err) => {
      log.error(`Edge proxy error for ${serverId} (${targetHost}:${targetPort}):`, err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Edge proxy error' });
    });

    req.pipe(proxy, { end: true });
  });

  log.info('Edge HTTP proxy registered at /edge/:serverId');
}
