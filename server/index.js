import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { initMediasoup } from './mediasoup.js';
import { initWebSocketServer } from './websocket.js';
import { config } from './config.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoint to get server info
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Video Call Server',
    version: '1.0.0',
    wsPort: config.server.wsPort,
  });
});

// Initialize server
async function startServer() {
  try {
    console.log('[Server] Starting server...');

    // Initialize mediasoup
    await initMediasoup();

    // Initialize WebSocket server
    initWebSocketServer(server);

    // Start HTTP server
    server.listen(config.server.port, () => {
      console.log(`[Server] HTTP server listening on port ${config.server.port}`);
      console.log(`[Server] WebSocket server running on port ${config.server.port}`);
      console.log(`[Server] Ready to accept connections`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
