import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';

/**
 * Create an Express app + HTTP server + Socket.IO instance
 * with common middleware (JSON parsing, CORS).
 *
 * @returns {{ app, httpServer, io }}
 */
export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIO(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(express.json());

  // CORS headers for REST endpoints
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  return { app, httpServer, io };
}
