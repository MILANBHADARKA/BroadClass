import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';
import { createLogger } from '../utils/logger.js';
import { CHANNEL_TRANSCRIPTION_CONTROL } from '../services/redisClient.js';

const log = createLogger('origin:transcription');

// Dedicated port range so we don't collide with recording (45000–45999) or
// the WebRTC range (40000–40399). Each transcription session burns 2 ports
// (RTP + RTCP), so 1000 ports support ~500 concurrent broadcasts per origin.
const MIN_TRANSCRIPTION_PORT = 46000;
const MAX_TRANSCRIPTION_PORT = 46999;
let nextTranscriptionPort = MIN_TRANSCRIPTION_PORT;

function getNextTranscriptionPort() {
  const port = nextTranscriptionPort;
  nextTranscriptionPort =
    nextTranscriptionPort >= MAX_TRANSCRIPTION_PORT - 1
      ? MIN_TRANSCRIPTION_PORT
      : nextTranscriptionPort + 2;
  return port;
}

// FFmpeg output format: 16-bit signed little-endian PCM, 16 kHz, mono.
// Deepgram (and most streaming STTs) accept this directly.
const PCM_SAMPLE_RATE_HZ = 16000;
const PCM_CHANNELS = 1;

// WebSocket reconnect / backpressure tuning. Frames are tiny (~20ms × 32 B/ms
// = ~640 B), so a queue of even a few hundred is negligible.
const WS_MAX_BUFFERED_BYTES = 1 * 1024 * 1024;       // 1 MB drop threshold
const WS_CONNECT_TIMEOUT_MS = 5000;
const FFMPEG_KILL_GRACE_MS = 1000;

export class OriginTranscriptionHandler {
  /**
   * @param {object} redisClient   – RedisClient instance (with .client + .subscriber)
   * @param {object} config        – { aiServiceUrl, internalApiKey, containerIp }
   */
  constructor(redisClient, config) {
    this.redisClient = redisClient;
    this.config = {
      aiServiceUrl: config.aiServiceUrl,
      internalApiKey: config.internalApiKey,
      containerIp: config.containerIp || '127.0.0.1',
    };
    this.broadcastRooms = new Map();  // roomId → { router, producers } reference
    this.sessions = new Map();        // broadcastId → session record
    this._subscriber = null;
  }

  /**
   * Track a broadcast so we can find its audio producer when the
   * transcription:control start event arrives.
   */
  registerBroadcastRoom(roomId, room) {
    this.broadcastRooms.set(roomId, room);
    log.debug(`Broadcast room registered for transcription: ${roomId}`);
  }

  /**
   * Detach. Caller (cleanupBroadcast) should publish transcription:control
   * stop separately so the session itself gets torn down.
   */
  unregisterBroadcastRoom(roomId) {
    this.broadcastRooms.delete(roomId);
  }

  /**
   * Subscribe to Redis `transcription:control`. Idempotent.
   */
  async setupRedisListeners() {
    if (this._subscriber) return;

    // Reuse the redisClient's existing subscriber connection by duplicating
    // it — mirrors the pattern in recordingHandler.setupRedisListeners.
    this._subscriber = this.redisClient.client.duplicate();
    await this._subscriber.connect();

    await this._subscriber.subscribe(CHANNEL_TRANSCRIPTION_CONTROL, (message) => {
      let event;
      try { event = JSON.parse(message); } catch {
        log.warn('Malformed transcription:control event:', message);
        return;
      }
      if (event?.type === 'start') {
        this.start({ broadcastId: event.broadcastId, classroomId: event.classroomId })
          .catch((err) => log.error(`Failed to start transcription for ${event.broadcastId}:`, err));
      } else if (event?.type === 'stop') {
        this.stop(event.broadcastId).catch((err) =>
          log.warn(`Failed to stop transcription for ${event.broadcastId}:`, err.message));
      } else {
        log.warn('Unknown transcription:control type:', event?.type);
      }
    });

    log.info(`Subscribed to ${CHANNEL_TRANSCRIPTION_CONTROL}`);
  }

  /**
   * Start a transcription session for a broadcast. Caller normally fires
   * this via Redis once the audio producer exists; calling it directly is
   * supported for tests and admin tools.
   *
   * Idempotent: if a session is already active for this broadcast, returns
   * without doing anything.
   */
  async start({ broadcastId, classroomId }) {
    if (!broadcastId) {
      log.warn('transcription.start missing broadcastId');
      return;
    }
    if (this.sessions.has(broadcastId)) {
      log.debug(`transcription.start.duplicate ${broadcastId}`);
      return;
    }

    const broadcast = this.broadcastRooms.get(broadcastId);
    if (!broadcast) {
      log.warn(`transcription.start: broadcast ${broadcastId} not registered`);
      return;
    }
    const audioProducer = broadcast.producers?.get('audio');
    if (!audioProducer) {
      // Could happen if start fires before the audio producer is created.
      // socketHandlers.js publishes start only on the audio kind so this is
      // a defensive check — log and bail.
      log.warn(`transcription.start: no audio producer for ${broadcastId}`);
      return;
    }

    // Diagnostic: dump the producer's state right at consume time. If
    // `paused=true` or the score is empty/zero, the producer isn't actually
    // receiving RTP from the broadcaster — no amount of consumer wiring
    // will help.
    log.info(
      `transcription.start ${broadcastId} — audioProducer ` +
      `kind=${audioProducer.kind} paused=${audioProducer.paused} ` +
      `closed=${audioProducer.closed} score=${JSON.stringify(audioProducer.score)}`
    );

    // Also subscribe to producer-side score updates. A non-zero producerScore
    // here would mean the broadcaster IS sending RTP — at which point the
    // bug is downstream (consumer / transport / UDP). All-zero or no events
    // means the broadcaster isn't sending (mic muted, Opus DTX during
    // silence, browser permissions, etc.).
    const onProducerScore = (score) => {
      log.info(`transcription[${broadcastId}] audioProducer score event: ${JSON.stringify(score)}`);
    };
    audioProducer.on('score', onProducerScore);
    // Remember to detach on stop so we don't leak listeners across sessions.
    this._producerScoreCleanups = this._producerScoreCleanups || new Map();
    this._producerScoreCleanups.set(broadcastId, () => {
      try { audioProducer.off('score', onProducerScore); } catch (_) {}
    });

    // Reserve a session slot synchronously so a racy stop doesn't slip
    // through before setup completes. We fill in resources as we go.
    const session = {
      broadcastId,
      classroomId,
      audioProducer,
      transport: null,
      consumer: null,
      ffmpeg: null,
      ws: null,
      sdpPath: null,
      stopping: false,
    };
    this.sessions.set(broadcastId, session);

    try {
      // 1. PlainTransport on the broadcast's router, loopback only.
      const rtpPort = getNextTranscriptionPort();
      const rtcpPort = rtpPort + 1;
      session.transport = await broadcast.router.createPlainTransport({
        listenIp: { ip: '127.0.0.1', announcedIp: null },
        rtcpMux: false,
        comedia: false,
      });
      await session.transport.connect({
        ip: '127.0.0.1',
        port: rtpPort,
        rtcpPort,
      });
      // Diagnostic: log the transport tuple so we can verify mediasoup is
      // actually configured to send to the port FFmpeg is listening on.
      log.info(
        `transcription[${broadcastId}] transport tuple: ${JSON.stringify(session.transport.tuple)}` +
        ` rtcpTuple: ${JSON.stringify(session.transport.rtcpTuple)}`
      );

      // 2. Consumer attached to the audio producer. Start paused so we
      //    only begin sending RTP once FFmpeg is bound.
      session.consumer = await session.transport.consume({
        producerId: audioProducer.id,
        rtpCapabilities: broadcast.router.rtpCapabilities,
        paused: true,
      });
      const codec = session.consumer.rtpParameters.codecs[0];
      const ssrc = session.consumer.rtpParameters.encodings[0].ssrc;

      // Surface producer-side pause/close events so we know if the upstream
      // audio is silent for reasons we can't see otherwise.
      session.consumer.on('producerpause', () =>
        log.warn(`transcription[${broadcastId}] producer paused → no RTP will flow`));
      session.consumer.on('producerresume', () =>
        log.info(`transcription[${broadcastId}] producer resumed`));
      session.consumer.on('producerclose', () =>
        log.warn(`transcription[${broadcastId}] producer closed`));

      // `score` events fire periodically with mediasoup's view of the
      // producer→consumer RTP flow quality. A non-zero score is proof
      // mediasoup IS receiving RTP from the producer and forwarding it
      // through this consumer. If we never see a score (or see all-zero
      // scores) the producer isn't actually forwarding to us — the
      // bug is upstream of FFmpeg.
      let _lastScoreLogged = -1;
      session.consumer.on('score', (score) => {
        if (score.score !== _lastScoreLogged) {
          log.info(`transcription[${broadcastId}] consumer score: ${score.score} producerScore: ${score.producerScore}`);
          _lastScoreLogged = score.score;
        }
      });
      // Also log producer paused state at consume time — if the producer
      // is paused from the start, no RTP will flow until we (or someone)
      // resumes the producer.
      log.info(
        `transcription[${broadcastId}] consumer ready ` +
        `paused=${session.consumer.paused} producerPaused=${session.consumer.producerPaused} ` +
        `kind=${session.consumer.kind} type=${session.consumer.type}`
      );

      // 3. SDP describing the inbound Opus stream — FFmpeg reads this.
      const sdp = this._buildSdp({
        port: rtpPort,
        payloadType: codec.payloadType,
        clockRate: codec.clockRate,
        channels: codec.channels || 2,
        ssrc,
        parameters: codec.parameters,
      });
      session.sdpPath = path.join(os.tmpdir(), `transcription-${broadcastId}.sdp`);
      fs.writeFileSync(session.sdpPath, sdp);
      log.info(`transcription[${broadcastId}] SDP written to ${session.sdpPath}:\n${sdp}`);

      // 4. Open WebSocket to ai-service /ingest. We open it BEFORE spawning
      //    FFmpeg so connection failures abort early rather than spilling
      //    audio frames into the void.
      session.ws = await this._openIngestWebSocket(broadcastId, classroomId);

      // 5. Spawn FFmpeg: SDP in, raw PCM out on stdout.
      //
      // analyzeduration/probesize are critical — without them, FFmpeg gives
      // up before enough Opus RTP packets arrive to analyze the stream and
      // produces no output (which we observed as Deepgram timing out with
      // 1011 "did not receive audio data"). 1s/100KB is a good middle ground:
      // long enough to analyze a starting RTP stream, short enough that the
      // first PCM bytes hit Deepgram within ~1.5 s of speech.
      const ffmpegArgs = [
        '-loglevel', 'info',
        '-protocol_whitelist', 'file,udp,rtp',
        '-analyzeduration', '1000000',  // 1 s
        '-probesize', '100000',         // 100 KB
        '-fflags', '+genpts+discardcorrupt+nobuffer',
        '-flags', 'low_delay',
        '-reorder_queue_size', '0',
        '-i', session.sdpPath,
        // Force a constant 16kHz mono s16le PCM output stream — what STT
        // engines (Deepgram, Whisper) expect.
        '-vn',
        '-f', 's16le',
        '-ar', String(PCM_SAMPLE_RATE_HZ),
        '-ac', String(PCM_CHANNELS),
        '-acodec', 'pcm_s16le',
        'pipe:1',
      ];
      session.ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      // 6. Wire stdout to the WebSocket with backpressure.
      session.ffmpeg.stdout.on('data', (chunk) => {
        const ws = session.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          // Slow ai-service — drop frames rather than memory-leak.
          // Doing this is preferable to crashing the origin.
          log.warn(`transcription[${broadcastId}] dropping frames; ws buffered=${ws.bufferedAmount}`);
          return;
        }
        ws.send(chunk, { binary: true });
      });

      // 7. Surface FFmpeg errors but don't kill the session on stderr lines
      //    (FFmpeg writes status frames to stderr). We promote info-ish
      //    stream-summary lines to .info so they show up at default log level
      //    — these are the lines that diagnose "FFmpeg started but no audio
      //    output" problems.
      session.ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (/error|fatal|invalid/i.test(msg)) {
          log.error(`transcription[${broadcastId}] ffmpeg: ${msg}`);
        } else if (/Stream|Input|Output|opus|pcm_s16le/i.test(msg)) {
          log.info(`transcription[${broadcastId}] ffmpeg: ${msg.substring(0, 240)}`);
        } else {
          log.debug(`transcription[${broadcastId}] ffmpeg: ${msg.substring(0, 240)}`);
        }
      });

      // Log the first chunk we receive from FFmpeg so it's obvious that the
      // pipeline is actually producing PCM. Subsequent chunks are silent.
      let _firstChunkLogged = false;
      session.ffmpeg.stdout.once('data', (chunk) => {
        _firstChunkLogged = true;
        log.info(`transcription[${broadcastId}] first PCM chunk (${chunk.length} bytes) → ai-service`);
      });
      void _firstChunkLogged;  // satisfy linters
      session.ffmpeg.on('error', (err) => {
        log.error(`transcription[${broadcastId}] ffmpeg process error:`, err);
        this.stop(broadcastId).catch(() => {});
      });
      session.ffmpeg.on('close', (code) => {
        log.info(`transcription[${broadcastId}] ffmpeg exited code=${code}`);
        // If FFmpeg dies unexpectedly, tear the session down.
        if (!session.stopping) this.stop(broadcastId).catch(() => {});
      });

      // 8. Give FFmpeg ~500ms to bind to UDP, then resume the consumer so
      //    RTP starts flowing. Same dance recordingHandler does.
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (this.sessions.get(broadcastId) === session && !session.stopping) {
        await session.consumer.resume();
        log.info(
          `transcription[${broadcastId}] consumer.resume() returned. ` +
          `paused=${session.consumer.paused} producerPaused=${session.consumer.producerPaused}`
        );
        log.info(`transcription[${broadcastId}] RTP flowing → FFmpeg → ai-service`);
      }
    } catch (err) {
      log.error(`transcription.start failed for ${broadcastId}:`, err);
      await this.stop(broadcastId).catch(() => {});
      throw err;
    }
  }

  /**
   * Tear down a transcription session. Idempotent.
   */
  async stop(broadcastId) {
    const session = this.sessions.get(broadcastId);
    if (!session || session.stopping) return;
    session.stopping = true;
    this.sessions.delete(broadcastId);

    // Detach producer-side score listener so we don't leak.
    const cleanup = this._producerScoreCleanups?.get(broadcastId);
    if (cleanup) {
      cleanup();
      this._producerScoreCleanups.delete(broadcastId);
    }

    log.info(`transcription.stop ${broadcastId}`);

    // FFmpeg: SIGTERM, escalate to SIGKILL — same shape as recordingHandler.
    if (session.ffmpeg && !session.ffmpeg.killed) {
      try { session.ffmpeg.stdin?.end(); } catch (_) {}
      try { session.ffmpeg.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { if (!session.ffmpeg.killed) session.ffmpeg.kill('SIGKILL'); } catch (_) {}
      }, FFMPEG_KILL_GRACE_MS);
    }

    // WebSocket: close cleanly so ai-service can finalize the Transcript row.
    try {
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.close(1000, 'transcription stopped');
      }
    } catch (_) {}

    // mediasoup resources.
    try { session.consumer?.close(); } catch (_) {}
    try { session.transport?.close(); } catch (_) {}

    // Best-effort cleanup of the SDP scratch file.
    if (session.sdpPath) {
      try { fs.unlinkSync(session.sdpPath); } catch (_) {}
    }
  }

  /**
   * Pause / resume the audio consumer for cost control (Phase 5).
   *
   * Pausing a mediasoup consumer stops RTP forwarding — FFmpeg stops getting
   * frames and Deepgram's session goes silent (free). We keep the underlying
   * Deepgram WebSocket open so resume is instantaneous; if the broadcast
   * stays viewer-less for a long time the next `stop()` will close everything
   * cleanly anyway.
   *
   * Tracking is in-memory: `setViewerCount` is the entry point called by
   * origin/index.js when broadcast:viewerCount events arrive.
   */
  setViewerCount(broadcastId, count) {
    const session = this.sessions.get(broadcastId);
    if (!session || session.stopping) return;
    const wasNonZero = session.lastViewerCount && session.lastViewerCount > 0;
    const willBeNonZero = count > 0;
    session.lastViewerCount = count;
    if (wasNonZero && !willBeNonZero) {
      // Falling to zero — pause to save STT minutes.
      this.pauseSession(broadcastId).catch((err) =>
        log.warn(`pauseSession failed for ${broadcastId}:`, err.message));
    } else if (!wasNonZero && willBeNonZero) {
      // First viewer joining — resume.
      this.resumeSession(broadcastId).catch((err) =>
        log.warn(`resumeSession failed for ${broadcastId}:`, err.message));
    }
  }

  async pauseSession(broadcastId) {
    const session = this.sessions.get(broadcastId);
    if (!session || session.stopping || session.consumer?.closed) return;
    if (session.consumer.paused) return;
    log.info(`transcription[${broadcastId}] pausing (viewerCount=0)`);
    try { await session.consumer.pause(); } catch (err) {
      log.warn(`pauseSession consumer.pause failed:`, err.message);
    }
  }

  async resumeSession(broadcastId) {
    const session = this.sessions.get(broadcastId);
    if (!session || session.stopping || session.consumer?.closed) return;
    if (!session.consumer.paused) return;
    log.info(`transcription[${broadcastId}] resuming (viewer joined)`);
    try { await session.consumer.resume(); } catch (err) {
      log.warn(`resumeSession consumer.resume failed:`, err.message);
    }
  }

  /**
   * Stop every active session — called from origin/index.js graceful shutdown.
   */
  async shutdown() {
    log.info(`transcription.shutdown — ${this.sessions.size} active session(s)`);
    const ids = Array.from(this.sessions.keys());
    await Promise.allSettled(ids.map((id) => this.stop(id)));
    if (this._subscriber) {
      try { await this._subscriber.unsubscribe(); } catch (_) {}
      try { await this._subscriber.quit(); } catch (_) {}
      this._subscriber = null;
    }
  }

  /**
   * Open a WebSocket to ai-service and resolve once it's OPEN (or reject on
   * timeout / handshake failure). The shared INTERNAL_API_KEY proves we're
   * a trusted internal service.
   */
  _openIngestWebSocket(broadcastId, classroomId) {
    return new Promise((resolve, reject) => {
      // Convert http://host:port → ws://host:port
      const wsBase = this.config.aiServiceUrl.replace(/^http/, 'ws');
      const url = `${wsBase}/ingest/${encodeURIComponent(broadcastId)}` +
        `?classroomId=${encodeURIComponent(classroomId || '')}` +
        `&sampleRate=${PCM_SAMPLE_RATE_HZ}&channels=${PCM_CHANNELS}`;

      const ws = new WebSocket(url, {
        headers: { 'X-Internal-Key': this.config.internalApiKey },
        handshakeTimeout: WS_CONNECT_TIMEOUT_MS,
      });

      const timeout = setTimeout(() => {
        try { ws.terminate(); } catch (_) {}
        reject(new Error(`ai-service /ingest connect timeout (${WS_CONNECT_TIMEOUT_MS}ms)`));
      }, WS_CONNECT_TIMEOUT_MS);

      ws.once('open', () => {
        clearTimeout(timeout);
        log.info(`ai-service ingest connected for ${broadcastId}`);
        resolve(ws);
      });
      ws.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      ws.on('close', (code, reason) => {
        log.info(`ai-service ingest closed for ${broadcastId} (code=${code} reason=${reason || ''})`);
        // If the ai-service hangs up mid-broadcast we tear down so we don't
        // leak FFmpeg / mediasoup resources.
        if (this.sessions.get(broadcastId)?.ws === ws) {
          this.stop(broadcastId).catch(() => {});
        }
      });
    });
  }

  _buildSdp({ port, payloadType, clockRate, channels, ssrc, parameters }) {
    // Identical format to the SDP that recordingHandler.generateSdpFile()
    // produces (LF line endings via template literal + concatenated `\n`s,
    // cname:audio not cname:transcription). recordingHandler is proven to
    // work end-to-end; mirroring its format eliminates SDP-parsing as a
    // variable when diagnosing FFmpeg "no input" issues.
    let sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=BroadClass Transcription
c=IN IP4 127.0.0.1
t=0 0
`;
    sdp += `m=audio ${port} RTP/AVP ${payloadType}\n`;
    sdp += `a=rtpmap:${payloadType} opus/${clockRate}/${channels}\n`;
    if (parameters) {
      const fmtp = Object.entries(parameters).map(([k, v]) => `${k}=${v}`).join(';');
      if (fmtp) sdp += `a=fmtp:${payloadType} ${fmtp}\n`;
    }
    if (ssrc) sdp += `a=ssrc:${ssrc} cname:audio\n`;
    sdp += `a=recvonly\n`;
    return sdp;
  }
}

export default OriginTranscriptionHandler;
