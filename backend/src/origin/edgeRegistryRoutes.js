/**
 * Internal Edge Registry API
 *
 * These endpoints are called by Edge servers to register/deregister themselves.
 * Protected by an internal API key (not user-facing).
 *
 * POST /api/internal/register-edge   – Edge registers itself on boot
 * POST /api/internal/heartbeat       – Edge sends periodic heartbeat
 * POST /api/internal/deregister-edge – Edge deregisters on shutdown
 * GET  /api/internal/edges           – List all registered edges
 */
import { Router } from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('edge-registry');
const router = Router();

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'broadclass-internal-key-change-in-production';

/** Middleware: verify internal API key */
function verifyInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Invalid internal API key' });
  }
  next();
}

router.use(verifyInternalKey);

/**
 * POST /api/internal/register-edge
 * Body: { serverId, ip, port, internalHost, internalPort, maxCapacity, region }
 */
router.post('/register-edge', async (req, res) => {
  try {
    const { serverId, ip, port, internalHost, internalPort, maxCapacity, region } = req.body;

    if (!serverId || !ip || !port) {
      return res.status(400).json({ error: 'serverId, ip, and port are required' });
    }

    const redisClient = req.app.locals.redisClient;

    await redisClient.registerEdge({
      ip,
      port,
      serverId,
      internalHost: internalHost || ip,
      internalPort: internalPort || port,
      maxCapacity: maxCapacity || 200,
      region: region || 'UNKNOWN',
    });

    // Keep in-memory proxy registry warm
    const edgeRegistry = req.app.locals.edgeRegistry;
    if (edgeRegistry) {
      edgeRegistry.set(serverId, { internalHost: internalHost || ip, internalPort: internalPort || port || 3002 });
    }

    log.info(`Edge registered via API: ${serverId} (${ip}:${port})`);
    res.json({ success: true, serverId, message: 'Edge registered' });
  } catch (err) {
    log.error('Edge registration failed:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

/**
 * POST /api/internal/heartbeat
 * Body: { serverId, userCount, cpuUsage?, memoryUsage? }
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { serverId, userCount, cpuUsage, memoryUsage } = req.body;

    if (!serverId) {
      return res.status(400).json({ error: 'serverId is required' });
    }

    const redisClient = req.app.locals.redisClient;
    const edge = await redisClient.updateEdgeHeartbeat(serverId, userCount || 0, { cpuUsage, memoryUsage });

    if (!edge) {
      // Edge not found in Redis — tell it to re-register
      return res.status(404).json({ error: 'Edge not found, please re-register', reRegister: true });
    }

    // Keep in-memory proxy registry warm
    const edgeRegistry = req.app.locals.edgeRegistry;
    if (edgeRegistry && edge.internalHost) {
      edgeRegistry.set(serverId, { internalHost: edge.internalHost, internalPort: edge.internalPort || 3002 });
    }

    res.json({ success: true, serverId });
  } catch (err) {
    log.error('Heartbeat failed:', err);
    res.status(500).json({ error: 'Heartbeat failed: ' + err.message });
  }
});

/**
 * POST /api/internal/deregister-edge
 * Body: { serverId }
 */
router.post('/deregister-edge', async (req, res) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({ error: 'serverId is required' });
    }

    const redisClient = req.app.locals.redisClient;
    await redisClient.removeEdge(serverId);

    log.info(`Edge deregistered via API: ${serverId}`);
    res.json({ success: true, serverId, message: 'Edge deregistered' });
  } catch (err) {
    log.error('Edge deregistration failed:', err);
    res.status(500).json({ error: 'Deregistration failed: ' + err.message });
  }
});

/**
 * GET /api/internal/edges
 * Returns list of all registered edges with health info
 */
router.get('/edges', async (req, res) => {
  try {
    const redisClient = req.app.locals.redisClient;
    const edges = await redisClient.getAllEdges();

    res.json({
      totalEdges: edges.length,
      edges: edges.map((e) => ({
        serverId: e.serverId,
        ip: e.ip,
        port: e.port,
        userCount: e.userCount,
        maxCapacity: e.maxCapacity,
        loadPercentage: ((e.userCount / e.maxCapacity) * 100).toFixed(1),
        cpuUsage: e.cpuUsage || null,
        memoryUsage: e.memoryUsage || null,
        lastHeartbeat: e.lastHeartbeat,
        isAlive: e.isAlive,
        region: e.region,
      })),
    });
  } catch (err) {
    log.error('Error listing edges:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================== */
/*  Auto-Scaling endpoints                                            */
/* ================================================================== */

/**
 * GET /api/internal/scaling/status
 * Returns current autoscaler state, managed vs static edges, config
 */
router.get('/scaling/status', async (req, res) => {
  try {
    const scaler = req.app.locals.edgeScaler;
    if (!scaler) {
      return res.json({ enabled: false, message: 'Auto-scaling is not enabled' });
    }
    const status = await scaler.getStatus();
    res.json(status);
  } catch (err) {
    log.error('Error getting scaling status:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/internal/scaling/up
 * Manually trigger a scale-up (adds one edge)
 */
router.post('/scaling/up', async (req, res) => {
  try {
    const scaler = req.app.locals.edgeScaler;
    if (!scaler) {
      return res.status(400).json({ error: 'Auto-scaling is not enabled' });
    }
    const edgeId = await scaler._scaleUp();
    if (edgeId) {
      res.json({ success: true, serverId: edgeId, message: 'Edge launched' });
    } else {
      res.status(500).json({ error: 'Failed to launch edge' });
    }
  } catch (err) {
    log.error('Manual scale-up failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/internal/scaling/down
 * Manually trigger a scale-down (removes one empty managed edge)
 * Body (optional): { serverId: "EDGE-AUTO-01" }
 */
router.post('/scaling/down', async (req, res) => {
  try {
    const scaler = req.app.locals.edgeScaler;
    if (!scaler) {
      return res.status(400).json({ error: 'Auto-scaling is not enabled' });
    }

    const { serverId } = req.body || {};

    if (serverId) {
      await scaler._scaleDown(serverId);
      return res.json({ success: true, serverId, message: 'Edge removed' });
    }

    // Auto-pick: least-loaded managed edge with 0 viewers
    const status = await scaler.getStatus();
    const redisClient = req.app.locals.redisClient;
    const edges = await redisClient.getAllEdges();
    const managed = new Set(status.managedEdges);

    const candidate = edges
      .filter((e) => managed.has(e.serverId) && parseInt(e.userCount) === 0)
      .sort((a, b) => parseInt(a.userCount) - parseInt(b.userCount))[0];

    if (!candidate) {
      return res.status(409).json({ error: 'No empty managed edge to remove' });
    }

    await scaler._scaleDown(candidate.serverId);
    res.json({ success: true, serverId: candidate.serverId, message: 'Edge removed' });
  } catch (err) {
    log.error('Manual scale-down failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
