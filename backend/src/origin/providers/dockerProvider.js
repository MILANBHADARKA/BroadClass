/**
 * Docker Provider for Edge Auto-Scaling
 *
 * Creates / removes edge-server containers as siblings via the Docker Engine API.
 * Requires the Docker socket to be mounted into the origin container:
 *     volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
 *
 * Port allocation strategy:
 *   HTTP : baseHttpPort + (edgeNum - 1)         →  3010, 3011, 3012 …
 *   RTP  : baseRtpPort + (edgeNum - 1) * rtpGap →  60000-60399, 60500-60899 …
 *
 * These ranges are separate from the static docker-compose edges (3002-3004, 50000-54399).
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('docker-provider');

let Docker;   // lazy-loaded so the module doesn't crash if dockerode isn't installed

export class DockerProvider {
  /**
   * @param {object} cfg
   * @param {string} cfg.imageName       – Docker image to use for edges
   * @param {string} cfg.networkName     – Docker network edges join
   * @param {number} cfg.baseHttpPort    – first HTTP host-port for dynamic edges
   * @param {number} cfg.baseRtpPort     – first RTP host-port range start
   * @param {number} cfg.rtpRangeSize    – ports per edge  (default 100)
   * @param {number} cfg.rtpGap          – gap between range starts (default 200)
   * @param {string} cfg.redisUrl
   * @param {string} cfg.jwtSecret
   * @param {string} cfg.internalApiKey
   * @param {string} cfg.announcedIp
   * @param {string} cfg.originHost      – hostname origin is reachable at inside Docker net
   * @param {number} cfg.originPort
   * @param {string} cfg.frontendOrigin
   * @param {string} cfg.logLevel
   * @param {number} cfg.maxCapacity
   */
  constructor(cfg = {}) {
    this.cfg = {
      imageName:      cfg.imageName     || 'broadclass-edge',
      networkName:    cfg.networkName   || 'broadclass_broadclass-network',
      baseHttpPort:   parseInt(cfg.baseHttpPort)  || 3010,
      baseRtpPort:    parseInt(cfg.baseRtpPort)   || 60000,
      rtpRangeSize:   parseInt(cfg.rtpRangeSize)  || 400,
      rtpGap:         parseInt(cfg.rtpGap)        || 500,
      redisUrl:       cfg.redisUrl       || 'redis://localhost:6379',
      jwtSecret:      cfg.jwtSecret      || 'dev-broadcast-jwt-secret-change-in-production',
      internalApiKey: cfg.internalApiKey || 'broadclass-internal-key-change-in-production',
      announcedIp:    cfg.announcedIp    || '127.0.0.1',
      originHost:     cfg.originHost     || 'origin-server',
      originPort:     parseInt(cfg.originPort) || 3001,
      frontendOrigin: cfg.frontendOrigin || 'https://broadclass.xyz',
      logLevel:       cfg.logLevel       || 'warn',
      maxCapacity:    parseInt(cfg.maxCapacity) || 200,
    };

    this.docker = null; // initialised in _ensureDocker()
  }

  /* ================================================================ */
  /*  Provider interface                                              */
  /* ================================================================ */

  /**
   * Launch a new edge container.
   * @param {string} serverId  e.g. "EDGE-AUTO-01"
   * @param {number} edgeNum   sequential number (used for port allocation)
   */
  async launchEdge(serverId, edgeNum) {
    await this._ensureDocker();

    const httpPort = this.cfg.baseHttpPort + edgeNum - 1;
    const rtpMin   = this.cfg.baseRtpPort + (edgeNum - 1) * this.cfg.rtpGap;
    const rtpMax   = rtpMin + this.cfg.rtpRangeSize - 1;
    const containerName = `broadclass-${serverId.toLowerCase()}`;

    log.info(
      `Launching ${serverId}: HTTP=${httpPort}  RTP=${rtpMin}-${rtpMax}`,
    );

    // Build env array
    const env = [
      `PORT=3002`,
      `EXTERNAL_PORT=${httpPort}`,
      `INTERNAL_HOST=${containerName}`,
      `NODE_ENV=production`,
      `ROLE=EDGE`,
      `SERVER_ID=${serverId}`,
      `ANNOUNCED_IP=${this.cfg.announcedIp}`,
      `ORIGIN_IP=${this.cfg.originHost}`,
      `ORIGIN_PORT=${this.cfg.originPort}`,
      `REDIS_URL=${this.cfg.redisUrl}`,
      `JWT_SECRET=${this.cfg.jwtSecret}`,
      `INTERNAL_API_KEY=${this.cfg.internalApiKey}`,
      `MAX_CAPACITY=${this.cfg.maxCapacity}`,
      `HEALTH_CHECK_INTERVAL=10000`,
      `LOG_LEVEL=${this.cfg.logLevel}`,
      `FRONTEND_ORIGIN=${this.cfg.frontendOrigin}`,
      `NUM_WORKERS=2`,
      `RTC_MIN_PORT=${rtpMin}`,
      `RTC_MAX_PORT=${rtpMax}`,
    ];

    // Port bindings  — HTTP + RTP/UDP range
    const portBindings = {
      '3002/tcp': [{ HostPort: String(httpPort) }],
    };
    const exposedPorts = { '3002/tcp': {} };

    for (let p = rtpMin; p <= rtpMax; p++) {
      const udpKey = `${p}/udp`;
      exposedPorts[udpKey] = {};
      portBindings[udpKey] = [{ HostPort: String(p) }];
    }

    // Create & start
    const container = await this.docker.createContainer({
      Image: this.cfg.imageName,
      name:  containerName,
      Env:   env,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings:  portBindings,
        NetworkMode:   this.cfg.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        StopTimeout:   10,
      },
    });

    await container.start();
    log.info(`Container ${containerName} (${container.id.slice(0, 12)}) started`);

    return serverId;
  }

  /**
   * Stop & remove an edge container.
   * @param {string} serverId  e.g. "EDGE-AUTO-01"
   */
  async removeEdge(serverId) {
    await this._ensureDocker();
    const containerName = `broadclass-${serverId.toLowerCase()}`;

    try {
      const container = this.docker.getContainer(containerName);
      await container.stop({ t: 10 });
      await container.remove();
      log.info(`Container ${containerName} removed`);
    } catch (err) {
      if (err.statusCode === 404) {
        log.warn(`Container ${containerName} already gone`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Check whether a managed edge is still running.
   * @param {string} serverId
   * @returns {Promise<boolean>}
   */
  async isEdgeRunning(serverId) {
    await this._ensureDocker();
    const containerName = `broadclass-${serverId.toLowerCase()}`;

    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();
      return info.State.Running === true;
    } catch (err) {
      return false;
    }
  }

  /* ================================================================ */
  /*  Internal helpers                                                */
  /* ================================================================ */

  /** Lazy-load dockerode (fails clearly if not installed) */
  async _ensureDocker() {
    if (this.docker) return;

    try {
      const mod = await import('dockerode');
      Docker = mod.default || mod;
      this.docker = new Docker();
      // Quick connectivity check
      await this.docker.ping();
      log.info('Connected to Docker Engine');
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'dockerode package is required for the Docker scaling provider.\n' +
          'Run:  npm install dockerode',
        );
      }
      throw new Error(`Cannot connect to Docker Engine: ${err.message}`);
    }
  }
}
