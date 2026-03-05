import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger.js';

const log = createLogger('app');
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://broadclass.xyz';

/**
 * Create an Express app + HTTP server + Socket.IO instance
 * with common middleware (JSON parsing, CORS, cookie-parser).
 *
 * @returns {{ app, httpServer, io }}
 */
export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIO(httpServer, {
    cors: {
      origin: FRONTEND_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Security headers with helmet (CSP disabled for WebRTC)
  app.use(helmet({
    contentSecurityPolicy: false, // Disabled for WebRTC/Socket.IO compatibility
    crossOriginEmbedderPolicy: false, // Required for Socket.IO
  }));

  // Request ID tracking for log correlation
  app.use((req, res, next) => {
    req.id = uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(express.json());
  app.use(cookieParser());

  // CORS headers for REST endpoints (credentials-aware)
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Error boundary - catch unhandled errors in routes
  app.use((err, req, res, next) => {
    log.error(`Unhandled error [${req.id}]:`, err.message, err.stack);
    
    // Don't leak error details in production
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(err.status || 500).json({
      error: isDev ? err.message : 'Internal server error',
      requestId: req.id,
      ...(isDev && { stack: err.stack })
    });
  });

  return { app, httpServer, io };
}
