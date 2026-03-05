/**
 * Edge Auto-Scaling Manager
 *
 * Monitors edge server utilization and dynamically scales the fleet:
 *   - Scales UP when any edge exceeds the load threshold
 *   - Scales DOWN when ALL edges are below the low-water mark (only removes empty edges)
 *   - Respects min/max edge counts and cooldown periods
 *   - Only manages edges it created — static (docker-compose) edges are never touched
 *
 * Uses a pluggable "provider" interface:
 *   - DockerProvider  →  local development (creates sibling containers)
 *   - AwsProvider     →  production (adjusts ASG desired capacity)
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('autoscaler');

/* ------------------------------------------------------------------ */
/*  Redis keys used for scaling state persistence                     */
/* ------------------------------------------------------------------ */
const REDIS_MANAGED_SET = 'autoscaler:managed-edges';   // SET of serverId strings
const REDIS_NEXT_NUM    = 'autoscaler:next-edge-number'; // counter

export class EdgeScalingManager {
  /**
   * @param {object}        opts
   * @param {RedisClient}   opts.redisClient   – shared Redis wrapper
   * @param {object}        opts.provider      – DockerProvider | AwsProvider
   * @param {object}        opts.config        – scaling knobs (see defaults below)
   */
  constructor({ redisClient, provider, config = {} }) {
    this.redisClient = redisClient;
    this.provider    = provider;

    this.config = {
      minEdges:           parseInt(config.minEdges)           || 2,
      maxEdges:           parseInt(config.maxEdges)           || 10,
      scaleUpThreshold:   parseFloat(config.scaleUpThreshold) || 70,   // % capacity
      scaleDownThreshold: parseFloat(config.scaleDownThreshold) || 20, // % capacity
      checkInterval:      parseInt(config.checkInterval)      || 30_000,  // ms
      cooldownUp:         parseInt(config.cooldownUp)         || 60_000,  // ms
      cooldownDown:       parseInt(config.cooldownDown)       || 120_000, // ms
    };

    this._intervalId   = null;
    this._lastScaleUp  = 0;
    this._lastScaleDown = 0;
    this._running       = false;
  }

  /* ================================================================ */
  /*  Lifecycle                                                       */
  /* ================================================================ */

  async start() {
    log.info(
      `Autoscaler started — min=${this.config.minEdges} max=${this.config.maxEdges} ` +
      `upAt=${this.config.scaleUpThreshold}% downAt=${this.config.scaleDownThreshold}%`,
    );

    // Recover managed-edge list from Redis (survives origin restarts)
    await this._recoverState();

    // Make sure we have at least minEdges running
    await this._ensureMinimumEdges();

    this._running = true;
    this._intervalId = setInterval(() => this._tick(), this.config.checkInterval);
  }

  async stop() {
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    log.info('Autoscaler stopped');
  }

  /* ================================================================ */
  /*  Core loop                                                       */
  /* ================================================================ */

  async _tick() {
    try {
      const edges = await this._getEdgeStatuses();
      const now   = Date.now();

      if (edges.length === 0) {
        await this._ensureMinimumEdges();
        return;
      }

      // ---- Scale UP ------------------------------------------------
      const maxLoad = Math.max(...edges.map(e => e.loadPct));

      if (maxLoad >= this.config.scaleUpThreshold && edges.length < this.config.maxEdges) {
        if (now - this._lastScaleUp >= this.config.cooldownUp) {
          log.warn(
            `SCALE UP — maxLoad=${maxLoad.toFixed(1)}%  edges=${edges.length}/${this.config.maxEdges}`,
          );
          await this._scaleUp();
          this._lastScaleUp = now;
          return; // don't also try to scale down in same tick
        }
        log.debug(
          `Scale-up needed but in cooldown (${Math.round((this.config.cooldownUp - (now - this._lastScaleUp)) / 1000)}s left)`,
        );
      }

      // ---- Scale DOWN ----------------------------------------------
      if (edges.length > this.config.minEdges) {
        const allLow = edges.every(e => e.loadPct <= this.config.scaleDownThreshold);

        if (allLow && now - this._lastScaleDown >= this.config.cooldownDown) {
          // Only remove an edge we manage AND that has 0 viewers
          const managed = await this._getManagedEdgeIds();
          const candidate = edges
            .filter(e => managed.has(e.serverId) && e.userCount === 0)
            .sort((a, b) => a.loadPct - b.loadPct)[0];           // least-loaded first

          if (candidate) {
            log.warn(
              `SCALE DOWN — removing ${candidate.serverId}  edges=${edges.length}→${edges.length - 1}`,
            );
            await this._scaleDown(candidate.serverId);
            this._lastScaleDown = now;
          }
        }
      }
    } catch (err) {
      log.error('Autoscaler tick failed:', err.message);
    }
  }

  /* ================================================================ */
  /*  Scaling actions                                                 */
  /* ================================================================ */

  async _scaleUp() {
    try {
      const edgeNum  = await this._nextEdgeNumber();
      const serverId = `EDGE-AUTO-${String(edgeNum).padStart(2, '0')}`;

      await this.provider.launchEdge(serverId, edgeNum);

      // Persist in Redis so we remember after origin restarts
      await this.redisClient.client.sAdd(REDIS_MANAGED_SET, serverId);

      log.info(`Launched edge ${serverId}`);
      return serverId;
    } catch (err) {
      log.error('Failed to launch edge:', err.message);
      return null;
    }
  }

  async _scaleDown(serverId) {
    try {
      await this.provider.removeEdge(serverId);

      // Clean up Redis
      await this.redisClient.client.sRem(REDIS_MANAGED_SET, serverId);
      await this.redisClient.removeEdge(serverId);

      log.info(`Removed edge ${serverId}`);
    } catch (err) {
      log.error(`Failed to remove edge ${serverId}:`, err.message);
    }
  }

  /* ================================================================ */
  /*  Ensure minimum fleet size                                       */
  /* ================================================================ */

  async _ensureMinimumEdges() {
    const edges   = await this._getEdgeStatuses();
    const running = edges.length;

    if (running < this.config.minEdges) {
      const needed = this.config.minEdges - running;
      log.info(`Need ${needed} more edge(s) to meet minimum (${running}/${this.config.minEdges})`);
      for (let i = 0; i < needed; i++) {
        await this._scaleUp();
      }
    }
  }

  /* ================================================================ */
  /*  Helpers                                                         */
  /* ================================================================ */

  /** Read edge health data from Redis */
  async _getEdgeStatuses() {
    const edges = await this.redisClient.getAllEdges();
    return edges.map(e => ({
      serverId:    e.serverId,
      userCount:   parseInt(e.userCount) || 0,
      maxCapacity: parseInt(e.maxCapacity) || 200,
      loadPct:     (parseInt(e.userCount) || 0) / (parseInt(e.maxCapacity) || 200) * 100,
      cpuUsage:    parseFloat(e.cpuUsage) || 0,
      memoryUsage: parseFloat(e.memoryUsage) || 0,
    }));
  }

  /** Retrieve the set of edge IDs this manager created */
  async _getManagedEdgeIds() {
    const ids = await this.redisClient.client.sMembers(REDIS_MANAGED_SET);
    return new Set(ids);
  }

  /** Auto-incrementing edge number (persists in Redis) */
  async _nextEdgeNumber() {
    return await this.redisClient.client.incr(REDIS_NEXT_NUM);
  }

  /** On startup, reconcile Redis state with provider reality */
  async _recoverState() {
    try {
      const managed = await this.redisClient.client.sMembers(REDIS_MANAGED_SET);
      if (managed.length === 0) return;

      log.info(`Recovering ${managed.length} managed edge(s) from previous session`);

      for (const serverId of managed) {
        const alive = await this.provider.isEdgeRunning(serverId);
        if (!alive) {
          log.warn(`Managed edge ${serverId} no longer running — removing from state`);
          await this.redisClient.client.sRem(REDIS_MANAGED_SET, serverId);
          await this.redisClient.removeEdge(serverId);
        }
      }
    } catch (err) {
      log.warn('State recovery failed (non-fatal):', err.message);
    }
  }

  /* ================================================================ */
  /*  Status (exposed via API)                                        */
  /* ================================================================ */

  async getStatus() {
    const managed = await this._getManagedEdgeIds();
    const edges   = await this._getEdgeStatuses();

    return {
      enabled:  this._running,
      config:   this.config,
      totalEdges:   edges.length,
      managedEdges: [...managed],
      staticEdges:  edges.filter(e => !managed.has(e.serverId)).map(e => e.serverId),
      lastScaleUp:   this._lastScaleUp   ? new Date(this._lastScaleUp).toISOString()   : null,
      lastScaleDown: this._lastScaleDown ? new Date(this._lastScaleDown).toISOString() : null,
    };
  }
}
