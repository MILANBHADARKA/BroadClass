import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import cookieParser from 'cookie-parser';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://localhost:5173';

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

  return { app, httpServer, io };
}
