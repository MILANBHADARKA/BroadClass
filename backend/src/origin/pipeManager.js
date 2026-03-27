/**
 * PipeTransport Manager – Origin → Edge media piping, Handles the full lifecycle for piping broadcast producers to edge servers, via mediasoup PipeTransport + HTTP handshake.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('origin:pipe');

/**
 * Pipe a broadcast to ALL active edge servers.
 *
 * @param {string}  roomId
 * @param {Map}     broadcasts   – shared originBroadcasts map
 * @param {object}  redisClient
 * @param {string}  containerIp  – Origin container's internal IP
 */
export async function connectEdgeServers(roomId, broadcasts, redisClient, containerIp) {
  const broadcast = broadcasts.get(roomId);
  if (!broadcast || broadcast.producers.size === 0) {
    log.warn(`No producers for ${roomId}, skipping pipe`);
    return;
  }

  const edges = await redisClient.getAllEdges();
  if (!edges?.length) {
    log.warn('No edge servers available for piping');
    return;
  }

  log.info(`Piping broadcast ${roomId} to ${edges.length} edge server(s)...`);
  log.info(`  Producers: ${Array.from(broadcast.producers.keys()).join(', ')}`);

  for (const edge of edges) {
    try {
      await pipeToEdgeWithRetry(roomId, edge, broadcasts, containerIp);
    } catch (err) {
      log.error(`Skipping ${edge.serverId} after all retries failed: ${err.message}`);
    }
  }

  log.info(`Piping complete for ${roomId}. Edges: ${broadcast.edgeServers.join(', ') || 'none'}`);
}

/**
 * Pipe a single broadcast to one specific edge (e.g. a newly registered edge).
 * Skips silently if the broadcast isn't active or is already piped to this edge.
 */
export async function pipeToNewEdge(roomId, edgeInfo, broadcasts, containerIp) {
  const broadcast = broadcasts.get(roomId);
  if (!broadcast || broadcast.producers.size === 0) {
    log.warn(`pipeToNewEdge: no producers for ${roomId}, skipping`);
    return;
  }
  if (broadcast.edgeServers?.includes(edgeInfo.serverId)) {
    log.info(`pipeToNewEdge: ${edgeInfo.serverId} already has ${roomId}, skipping`);
    return;
  }
  log.info(`Auto-piping ${roomId} to newly registered edge ${edgeInfo.serverId}`);
  await pipeToEdgeWithRetry(roomId, edgeInfo, broadcasts, containerIp);
}

/**
 * Retry wrapper for pipeToEdge with exponential backoff.
 * Skips the edge permanently after maxAttempts failures.
 */
async function pipeToEdgeWithRetry(roomId, edgeInfo, broadcasts, containerIp, maxAttempts = 3) {
  const delays = [500, 1000, 2000];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await pipeToEdge(roomId, edgeInfo, broadcasts, containerIp);
      return;
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      log.warn(
        `Pipe attempt ${attempt + 1}/${maxAttempts} to ${edgeInfo.serverId} failed: ${err.message}. ` +
        `Retrying in ${delays[attempt]}ms...`,
      );
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

/**
 * Pipe a broadcast to a single edge server via HTTP handshake.
 *
 * Flow:
 *  1. Origin creates PipeTransport
 *  2. POST /api/pipe-setup to edge
 *  3. Origin connects its pipe to edge
 *  4. Origin consumes each producer through pipe → creates pipeConsumers
 *  5. POST /api/pipe-produce to edge → edge creates virtual producers
 *  6. Store pipe info, update Redis
 */
async function pipeToEdge(roomId, edgeInfo, broadcasts, containerIp) {
  const broadcast = broadcasts.get(roomId);
  const edgeUrl = `http://${edgeInfo.internalHost}:${edgeInfo.internalPort}`;

  log.info(`  Piping to ${edgeInfo.serverId} (${edgeUrl})...`);

  // 1. Create PipeTransport on origin
  const pipeTransport = await broadcast.router.createPipeTransport({
    listenInfo: { protocol: 'udp', ip: '0.0.0.0', announcedIp: containerIp },
    enableSrtp: true,
    enableSctp: false,
    enableRtx: false,
  });

  log.info(`    Origin pipe: ${containerIp}:${pipeTransport.tuple.localPort}`);

  try {
    // 2. Call edge pipe-setup
    const setupRes = await fetch(`${edgeUrl}/api/pipe-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId,
        originPipeIp: containerIp,
        originPipePort: pipeTransport.tuple.localPort,
        originSrtpParameters: pipeTransport.srtpParameters,
      }),
    });

    if (!setupRes.ok) throw new Error(`pipe-setup failed: ${await setupRes.text()}`);
    const setupData = await setupRes.json();
    log.info(`    Edge pipe: ${setupData.edgePipeIp}:${setupData.edgePipePort}`);

    // 3. Connect origin pipe to edge
    await pipeTransport.connect({
      ip: setupData.edgePipeIp,
      port: setupData.edgePipePort,
      srtpParameters: setupData.edgeSrtpParameters,
    });
    log.info('    Origin pipe connected to edge');

    // 4. Consume each producer through the pipe
    const producerInfos = [];
    for (const [kind, producer] of broadcast.producers) {
      const pipeConsumer = await pipeTransport.consume({ producerId: producer.id });
      producerInfos.push({
        consumerId: pipeConsumer.id,
        kind: pipeConsumer.kind,
        rtpParameters: pipeConsumer.rtpParameters,
      });
      log.info(`    Pipe consumer: ${kind} (${pipeConsumer.id})`);
    }

    // 5. Tell edge to create virtual producers
    const produceRes = await fetch(`${edgeUrl}/api/pipe-produce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, producers: producerInfos }),
    });

    if (!produceRes.ok) throw new Error(`pipe-produce failed: ${await produceRes.text()}`);
    const produceData = await produceRes.json();
    log.info(`    Edge virtual producers created:`, produceData.producers);

    // 6. Store pipe info — close any pre-existing pipe to this edge first (re-broadcast case)
    const existing = broadcast.pipeTransports.get(edgeInfo.serverId);
    if (existing) {
      try { existing.transport.close(); } catch (_) {}
      broadcast.edgeServers = broadcast.edgeServers.filter((id) => id !== edgeInfo.serverId);
    }
    broadcast.pipeTransports.set(edgeInfo.serverId, {
      transport: pipeTransport,
      edgeInfo,
      createdAt: Date.now(),
    });
    broadcast.edgeServers.push(edgeInfo.serverId);

    log.info(`  ${edgeInfo.serverId} fully connected to broadcast ${roomId}`);
  } catch (err) {
    pipeTransport.close();
    throw err;
  }
}

/**
 * Tear down the pipe to a single edge (e.g. edge went offline mid-broadcast).
 * Closes the origin-side pipe transport, notifies the edge, and removes it
 * from the broadcast's active edge list.
 */
export async function cleanupSingleEdgePipe(roomId, edgeServerId, broadcasts) {
  const broadcast = broadcasts.get(roomId);
  if (!broadcast) return;

  const pipeInfo = broadcast.pipeTransports.get(edgeServerId);
  if (!pipeInfo) return;

  const edgeUrl = `http://${pipeInfo.edgeInfo.internalHost}:${pipeInfo.edgeInfo.internalPort}`;
  fetch(`${edgeUrl}/api/pipe-cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  }).catch((e) => log.error(`Cleanup notify to ${edgeServerId} failed: ${e.message}`));

  try { pipeInfo.transport.close(); } catch (_) {}
  broadcast.pipeTransports.delete(edgeServerId);
  broadcast.edgeServers = broadcast.edgeServers.filter((id) => id !== edgeServerId);
  log.info(`Cleaned up single edge pipe: ${roomId} → ${edgeServerId}`);
}

/**
 * Notify edge servers that a broadcast has ended, and clean up pipe resources.
 */
export async function cleanupPipes(broadcast) {
  for (const [serverId, pipeInfo] of broadcast.pipeTransports) {
    try {
      const edgeUrl = `http://${pipeInfo.edgeInfo.internalHost}:${pipeInfo.edgeInfo.internalPort}`;
      fetch(`${edgeUrl}/api/pipe-cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: broadcast.roomId }),
      }).catch((e) => log.error(`Error notifying ${serverId}: ${e.message}`));
    } catch (_) {
      /* best-effort */
    }
    try {
      pipeInfo.transport.close();
    } catch (_) {
      /* already closed */
    }
  }
}
