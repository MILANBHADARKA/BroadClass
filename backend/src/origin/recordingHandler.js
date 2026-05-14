/**
 * Recording Handler for Origin Server
 * 
 * Handles recording lifecycle:
 * 1. Listen for recording:start events from System-Manager (via Redis)
 * 2. Capture broadcast stream via mediasoup PlainTransport + Consumer
 * 3. Pipe RTP to FFmpeg → S3 upload
 * 4. On completion, update DB status to READY
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { S3RecordingService } from '../services/s3Service.js';
import prisma from '../services/prisma.js';
import { createLogger } from '../utils/logger.js';
import { S3_MULTIPART_CHUNK_SIZE } from '../config/constants.js';

const log = createLogger('origin:recording');

// Port range for recording RTP transports (avoid conflicts with WebRTC)
let nextRecordingPort = 45000;
const MAX_RECORDING_PORT = 45999;

function getNextRecordingPort() {
  const port = nextRecordingPort;
  nextRecordingPort = nextRecordingPort >= MAX_RECORDING_PORT ? 45000 : nextRecordingPort + 2;
  return port;
}

export class OriginRecordingHandler {
  constructor(redisClient, getNextWorker, io = null) {
    this.redisClient = redisClient;
    this.getNextWorker = getNextWorker;
    this.io = io; // Socket.IO server instance for direct client events
    this.s3Service = new S3RecordingService({});
    this.broadcastRooms = new Map(); // roomId → broadcast object
    this.activeRecordings = new Map(); // recordingId → { roomId, ffmpeg, transport, consumers, sdpPath, ... }
  }

  /**
   * Set Socket.IO instance (called after initialization)
   */
  setSocketIO(io) {
    this.io = io;
  }

  /**
   * Register a broadcast room (called when broadcaster joins)
   */
  registerBroadcastRoom(roomId, room) {
    this.broadcastRooms.set(roomId, room);
    log.info(`Broadcast room registered for recording: ${roomId}`);
  }

  /**
   * Unregister broadcast room (called when broadcast ends)
   */
  unregisterBroadcastRoom(roomId) {
    // Stop any active recordings for this room
    for (const [recordingId, recording] of this.activeRecordings) {
      if (recording.roomId === roomId) {
        this.stopRecording(recordingId).catch(err => 
          log.error(`Failed to stop recording ${recordingId}:`, err)
        );
      }
    }
    this.broadcastRooms.delete(roomId);
    log.info(`Broadcast room unregistered from recording: ${roomId}`);
  }

  /**
   * Start recording a broadcast
   * Creates PlainTransport + Consumers to pipe media to FFmpeg
   */
  async startRecording(recordingId, roomId, filename = 'broadcast.mp4') {
    const broadcast = this.broadcastRooms.get(roomId);
    
    if (!broadcast) {
      throw new Error(`Broadcast room ${roomId} not found`);
    }

    if (this.activeRecordings.has(recordingId)) {
      throw new Error(`Recording ${recordingId} is already active`);
    }

    try {
      const { router, producers } = broadcast;

      // Get video and audio producers
      const videoProducer = producers.get('video');
      const audioProducer = producers.get('audio');

      if (!videoProducer) {
        throw new Error(`No video producer found in room ${roomId}`);
      }

      log.info(`📹 Starting recording of broadcast ${roomId} (recording: ${recordingId})`);

      // Allocate ports for RTP (video) and RTCP, and audio
      const videoRtpPort = getNextRecordingPort();
      const videoRtcpPort = videoRtpPort + 1;
      const audioRtpPort = audioProducer ? getNextRecordingPort() : 0;
      const audioRtcpPort = audioProducer ? audioRtpPort + 1 : 0;

      log.info(`Allocated recording ports - video: ${videoRtpPort}/${videoRtcpPort}, audio: ${audioRtpPort}/${audioRtcpPort}`);

      // Create PlainTransport for video
      // With comedia: false, we specify where to send RTP data
      const videoTransport = await router.createPlainTransport({
        listenIp: { ip: '127.0.0.1', announcedIp: null },
        rtcpMux: false,
        comedia: false,
      });

      // Connect transport to send RTP to our designated ports
      await videoTransport.connect({
        ip: '127.0.0.1',
        port: videoRtpPort,
        rtcpPort: videoRtcpPort,
      });

      log.info(`Video transport tuple: ${JSON.stringify(videoTransport.tuple)}`);
      log.info(`Video transport connected - sending to 127.0.0.1:${videoRtpPort}`);

      // Create video consumer on the transport
      const videoConsumer = await videoTransport.consume({
        producerId: videoProducer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused: true,  // Start paused, resume after FFmpeg is ready
      });

      const videoCodec = videoConsumer.rtpParameters.codecs[0];
      const videoSsrc = videoConsumer.rtpParameters.encodings[0].ssrc;
      const videoPt = videoCodec.payloadType;
      log.info(`Video consumer created: ${videoConsumer.id}`);
      log.info(`  Codec: ${videoCodec.mimeType}, PT: ${videoPt}, SSRC: ${videoSsrc}`);

      // Create PlainTransport and consumer for audio if available
      let audioTransport = null;
      let audioConsumer = null;
      let audioSsrc = null;
      let audioPt = null;
      let audioCodec = null;

      if (audioProducer) {
        audioTransport = await router.createPlainTransport({
          listenIp: { ip: '127.0.0.1', announcedIp: null },
          rtcpMux: false,
          comedia: false,
        });

        await audioTransport.connect({
          ip: '127.0.0.1',
          port: audioRtpPort,
          rtcpPort: audioRtcpPort,
        });

        log.info(`Audio transport tuple: ${JSON.stringify(audioTransport.tuple)}`);
        log.info(`Audio transport connected - sending to 127.0.0.1:${audioRtpPort}`);

        audioConsumer = await audioTransport.consume({
          producerId: audioProducer.id,
          rtpCapabilities: router.rtpCapabilities,
          paused: true,  // Start paused, resume after FFmpeg is ready
        });

        audioSsrc = audioConsumer.rtpParameters.encodings[0].ssrc;
        audioCodec = audioConsumer.rtpParameters.codecs[0];
        audioPt = audioCodec.payloadType;
        log.info(`Audio consumer created: ${audioConsumer.id}`);
        log.info(`  Codec: ${audioCodec.mimeType}, PT: ${audioPt}, SSRC: ${audioSsrc}`);
      }

      // Generate SDP file for FFmpeg with SSRC information
      const sdpContent = this.generateSdpFile(
        videoConsumer.rtpParameters,
        videoRtpPort,
        videoSsrc,
        audioConsumer?.rtpParameters,
        audioRtpPort,
        audioSsrc
      );

      // Write SDP to temp file
      const sdpPath = path.join(os.tmpdir(), `recording-${recordingId}.sdp`);
      fs.writeFileSync(sdpPath, sdpContent);
      log.info(`SDP file written to: ${sdpPath}`);
      log.debug(`SDP content:\n${sdpContent}`);

      // Determine output format based on video codec
      // VP8/VP9 → WebM container (native support)
      // H264 → MP4 container
      const videoCodecName = videoCodec.mimeType.split('/')[1].toLowerCase();
      const useWebM = videoCodecName === 'vp8' || videoCodecName === 'vp9';
      const fileExtension = useWebM ? 'webm' : 'mp4';

      // Update filename extension based on codec
      const actualFilename = filename.replace(/\.(mp4|webm)$/i, '') + '.' + fileExtension;

      log.info(`Video codec: ${videoCodecName}, using ${fileExtension} container`);

      // Initialize S3 multipart upload with correct filename
      const { uploadId, s3Key } = await this.s3Service.initiateUpload(recordingId, actualFilename);

      // Build FFmpeg arguments for RTP input → container output
      // Key settings:
      // - analyzeduration/probesize: give FFmpeg time to analyze streams
      // - reorder_queue_size: buffer for out-of-order packets
      // - fflags +genpts: generate presentation timestamps
      // - For WebM: VP8/VP9 + Opus work natively
      // - For MP4: H264 + AAC
      let ffmpegArgs;

      if (useWebM) {
        // WebM container - VP8/VP9 video + Opus audio (copy both, no transcoding)
        ffmpegArgs = [
          // Global options
          '-loglevel', 'info',  // More verbose for debugging
          '-protocol_whitelist', 'file,udp,rtp',
          // Input analysis options - give FFmpeg time to detect streams
          '-analyzeduration', '10000000',  // 10 seconds
          '-probesize', '10000000',  // 10MB
          // Input options (before -i)
          '-fflags', '+genpts+discardcorrupt',
          '-reorder_queue_size', '1000',
          '-max_delay', '1000000',  // 1 second max delay
          '-i', sdpPath,
          // Video output - copy VP8/VP9 codec
          '-map', '0:v:0?',  // ? = optional, don't fail if missing
          '-c:v', 'copy',
          // Audio output - copy Opus (WebM supports Opus natively)
          ...(audioConsumer ? ['-map', '0:a:0?', '-c:a', 'copy'] : ['-an']),
          // Output format - WebM with cluster-based streaming
          '-f', 'webm',
          '-cluster_size_limit', '2M',
          '-cluster_time_limit', '5000',
          'pipe:1',
        ];
      } else {
        // MP4 container - H264 video + AAC audio
        ffmpegArgs = [
          // Global options
          '-loglevel', 'info',
          '-protocol_whitelist', 'file,udp,rtp',
          // Input analysis options
          '-analyzeduration', '10000000',
          '-probesize', '10000000',
          // Input options (before -i)
          '-fflags', '+genpts+discardcorrupt',
          '-reorder_queue_size', '1000',
          '-max_delay', '1000000',
          '-i', sdpPath,
          // Video output - copy H264 codec
          '-map', '0:v:0?',
          '-c:v', 'copy',
          // Audio output - transcode to AAC (Opus not supported in MP4)
          ...(audioConsumer ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000'] : ['-an']),
          // Output format - fragmented MP4 for streaming
          '-f', 'mp4',
          '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
          'pipe:1',
        ];
      }

      log.info(`Starting FFmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Wait a moment for FFmpeg to bind to UDP ports, then resume consumers
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Resume consumers to start sending RTP to FFmpeg
      log.info('Resuming consumers to start RTP flow...');
      await videoConsumer.resume();
      if (audioConsumer) {
        await audioConsumer.resume();
      }
      log.info('Consumers resumed - RTP should now be flowing to FFmpeg');

      // Handle FFmpeg output - stream to S3
      let partNumber = 1;
      let chunkBuffer = Buffer.alloc(0);
      const CHUNK_SIZE = S3_MULTIPART_CHUNK_SIZE;
      let totalUploadedBytes = 0;

      // Reference to `this` for use in callbacks
      const self = this;

      ffmpeg.stdout.on('data', async (data) => {
        // Stop processing buffered data once the recording has been marked failed.
        // FFmpeg may flush a few more chunks before SIGTERM takes effect.
        // (recState may briefly be undefined during startup before activeRecordings.set —
        // in that window we simply haven't been marked failed yet.)
        const recState = self.activeRecordings.get(recordingId);
        if (recState?.failed) return;

        chunkBuffer = Buffer.concat([chunkBuffer, data]);

        while (chunkBuffer.length >= CHUNK_SIZE) {
          const chunk = chunkBuffer.slice(0, CHUNK_SIZE);
          chunkBuffer = chunkBuffer.slice(CHUNK_SIZE);

          try {
            await self.s3Service.uploadChunk(recordingId, chunk, partNumber, self.redisClient);
            totalUploadedBytes += chunk.length;
            partNumber++;
            log.debug(`Uploaded chunk ${partNumber - 1}, total: ${(totalUploadedBytes / (1024 * 1024)).toFixed(1)} MB`);

            // Emit progress event
            const progressEvent = {
              recordingId,
              roomId,
              uploadedBytes: totalUploadedBytes,
              timestamp: Date.now(),
            };

            if (self.io) {
              self.io.emit('recording:progress', progressEvent);
            }

            // Also publish to Redis for System-Manager
            try {
              await self.redisClient.client.publish('recording:progress', JSON.stringify(progressEvent));
            } catch (pubErr) {
              // Non-critical, just log
              log.debug('Failed to publish progress to Redis:', pubErr.message);
            }
          } catch (err) {
            log.error(`Failed to upload chunk ${partNumber}:`, err.message);
            // Subsequent parts would be numbered as if this one succeeded, producing
            // a corrupt object. Tear down the recording instead of silently continuing.
            await self._markRecordingFailed(recordingId, `chunk upload failed: ${err.message}`);
            return;
          }
        }

        // Update recording state with latest values (recState may be undefined
        // during the brief startup window before activeRecordings.set runs).
        if (recState && !recState.failed) {
          recState.partNumber = partNumber;
          recState.chunkBuffer = chunkBuffer;
          recState.totalUploadedBytes = totalUploadedBytes;
        }
      });

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        // Log all FFmpeg output for debugging (loglevel is already set to 'info')
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal') || msg.toLowerCase().includes('invalid')) {
          log.error(`FFmpeg error: ${msg}`);
        } else if (msg.includes('Stream') || msg.includes('Input') || msg.includes('Output') || msg.includes('frame=')) {
          log.info(`FFmpeg: ${msg}`);
        } else {
          log.debug(`FFmpeg: ${msg.substring(0, 300)}`);
        }
      });

      ffmpeg.on('error', (err) => {
        log.error(`FFmpeg process error:`, err);
      });

      ffmpeg.on('close', (code) => {
        log.info(`FFmpeg process exited with code ${code}`);
      });

      // Store recording state
      this.activeRecordings.set(recordingId, {
        roomId,
        ffmpeg,
        videoTransport,
        audioTransport,
        videoConsumer,
        audioConsumer,
        sdpPath,
        s3Key,
        uploadId,
        partNumber,
        chunkBuffer,
        totalUploadedBytes,
        startTime: Date.now(),
      });

      // Publish status to Redis and emit via Socket.IO
      const statusEvent = {
        recordingId,
        roomId,
        status: 'recording_started',
        timestamp: Date.now(),
      };

      try {
        await this.redisClient.client.publish('recording:status', JSON.stringify(statusEvent));
      } catch (err) {
        log.warn('Failed to publish recording status to Redis:', err.message);
      }

      // Also emit directly via Socket.IO (for clients connected to Origin)
      if (this.io) {
        this.io.emit('recording:status', statusEvent);
      }

      log.info(`✅ Recording started: ${recordingId}`);
      return { recordingId, status: 'RECORDING' };

    } catch (err) {
      log.error(`Failed to start recording ${recordingId}:`, err);
      
      // Update DB status to FAILED
      try {
        await prisma.recording.update({
          where: { id: recordingId },
          data: { status: 'FAILED' },
        });
      } catch (dbErr) {
        log.error(`Failed to update recording status:`, dbErr);
      }

      throw err;
    }
  }

  /**
   * Stop recording and finalize S3 upload
   */
  async stopRecording(recordingId) {
    const recording = this.activeRecordings.get(recordingId);
    
    if (!recording) {
      throw new Error(`Recording ${recordingId} not active`);
    }

    try {
      log.info(`⏹️  Stopping recording: ${recordingId}`);

      const { ffmpeg, videoTransport, audioTransport, videoConsumer, audioConsumer, sdpPath, chunkBuffer } = recording;

      // Pause consumers first to stop RTP flow
      try {
        if (videoConsumer && !videoConsumer.closed) {
          await videoConsumer.pause();
        }
        if (audioConsumer && !audioConsumer.closed) {
          await audioConsumer.pause();
        }
        log.info('Consumers paused');
      } catch (err) {
        log.warn('Error pausing consumers:', err.message);
      }

      // Gracefully stop FFmpeg
      if (ffmpeg && !ffmpeg.killed) {
        ffmpeg.stdin?.write('q'); // Send quit command
        
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            ffmpeg.kill('SIGKILL');
            resolve();
          }, 3000);

          ffmpeg.on('close', () => {
            clearTimeout(timeout);
            resolve();
          });

          // Also try SIGTERM
          setTimeout(() => {
            if (!ffmpeg.killed) {
              ffmpeg.kill('SIGTERM');
            }
          }, 500);
        });
      }

      // Upload final chunk if any remaining data
      if (chunkBuffer && chunkBuffer.length > 0) {
        try {
          await this.s3Service.uploadChunk(recordingId, chunkBuffer, recording.partNumber, this.redisClient);
          recording.totalUploadedBytes += chunkBuffer.length;
          log.info(`Uploaded final chunk: ${chunkBuffer.length} bytes`);
        } catch (err) {
          log.warn(`Failed to upload final chunk:`, err.message);
        }
      }

      // Complete S3 multipart upload
      let result;
      try {
        result = await this.s3Service.completeUpload(recordingId);
      } catch (err) {
        log.error(`Failed to complete S3 upload:`, err.message);
        // Try to abort the upload
        await this.s3Service.abortUpload(recordingId).catch(() => {});
        throw err;
      }

      // Close mediasoup resources
      try {
        videoConsumer?.close();
        audioConsumer?.close();
        videoTransport?.close();
        audioTransport?.close();
      } catch (err) {
        log.warn('Error closing mediasoup resources:', err.message);
      }

      // Clean up SDP file
      try {
        if (sdpPath && fs.existsSync(sdpPath)) {
          fs.unlinkSync(sdpPath);
        }
      } catch (err) {
        log.warn('Failed to delete SDP file:', err.message);
      }

      const duration = Math.round((Date.now() - recording.startTime) / 1000);

      // Update DB status to READY
      try {
        await prisma.recording.update({
          where: { id: recordingId },
          data: {
            status: 'READY',
            s3Key: result.key,
            s3Url: result.location || `https://${this.s3Service.config.bucket}.s3.${this.s3Service.config.region}.amazonaws.com/${result.key}`,
            duration,
            fileSize: BigInt(result.fileSize || recording.totalUploadedBytes),
          },
        });
      } catch (dbErr) {
        log.error(`Failed to update recording in DB:`, dbErr);
      }

      // Remove from active recordings
      this.activeRecordings.delete(recordingId);

      // Publish completion status
      const completionEvent = {
        recordingId,
        roomId: recording.roomId,
        status: 'recording_completed',
        duration,
        fileSize: result.fileSize || recording.totalUploadedBytes,
        timestamp: Date.now(),
      };

      try {
        await this.redisClient.client.publish('recording:status', JSON.stringify(completionEvent));
      } catch (err) {
        log.warn('Failed to publish recording completion to Redis:', err.message);
      }

      // Also emit directly via Socket.IO
      if (this.io) {
        this.io.emit('recording:status', completionEvent);
      }

      log.info(`✅ Recording completed: ${recordingId} (${duration}s, ${((result.fileSize || recording.totalUploadedBytes) / (1024 * 1024)).toFixed(1)} MB)`);

      return { 
        recordingId, 
        status: 'READY', 
        s3Url: result.location,
        duration,
        fileSize: result.fileSize || recording.totalUploadedBytes,
      };

    } catch (err) {
      log.error(`Failed to stop recording ${recordingId}:`, err);

      // Mark as failed in DB
      try {
        await prisma.recording.update({
          where: { id: recordingId },
          data: { status: 'FAILED' },
        });
      } catch (dbErr) {
        log.error(`Failed to mark recording as failed:`, dbErr);
      }

      // Clean up
      this.activeRecordings.delete(recordingId);

      throw err;
    }
  }

  /**
   * Tear down a recording that has hit an unrecoverable error mid-stream
   * (e.g. an S3 chunk upload failure). Idempotent: safe to call concurrently
   * with stopRecording or itself.
   */
  async _markRecordingFailed(recordingId, reason) {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording || recording.failed) return;
    recording.failed = true;

    log.error(`Recording ${recordingId} failed: ${reason}`);

    const { ffmpeg, videoTransport, audioTransport, videoConsumer, audioConsumer, sdpPath, roomId } = recording;

    // Notify clients first so the UI can react before cleanup latency.
    const failureEvent = {
      recordingId,
      roomId,
      status: 'recording_failed',
      reason,
      timestamp: Date.now(),
    };
    try { await this.redisClient.client.publish('recording:status', JSON.stringify(failureEvent)); }
    catch (err) { log.warn('Failed to publish recording failure to Redis:', err.message); }
    if (this.io) this.io.emit('recording:status', failureEvent);

    // Stop FFmpeg — SIGTERM, escalating to SIGKILL if it lingers.
    if (ffmpeg && !ffmpeg.killed) {
      try { ffmpeg.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { if (!ffmpeg.killed) ffmpeg.kill('SIGKILL'); } catch (_) {} }, 1000);
    }

    // Abort the multipart upload so S3 doesn't accumulate orphan parts (billed).
    await this.s3Service.abortUpload(recordingId).catch((err) =>
      log.warn(`Failed to abort S3 upload for ${recordingId}:`, err.message));

    // Close mediasoup resources.
    try { videoConsumer?.close(); } catch (_) {}
    try { audioConsumer?.close(); } catch (_) {}
    try { videoTransport?.close(); } catch (_) {}
    try { audioTransport?.close(); } catch (_) {}

    // Remove SDP file.
    try { if (sdpPath && fs.existsSync(sdpPath)) fs.unlinkSync(sdpPath); }
    catch (err) { log.warn('Failed to delete SDP file:', err.message); }

    // Persist FAILED status.
    try {
      await prisma.recording.update({
        where: { id: recordingId },
        data: { status: 'FAILED' },
      });
    } catch (dbErr) {
      log.error(`Failed to mark recording ${recordingId} as FAILED in DB:`, dbErr);
    }

    this.activeRecordings.delete(recordingId);
  }

  /**
   * Generate SDP file content for FFmpeg to read RTP streams
   * SSRC is critical for FFmpeg to properly identify and synchronize streams
   */
  generateSdpFile(videoRtpParams, videoPort, videoSsrc, audioRtpParams, audioPort, audioSsrc) {
    const videoCodec = videoRtpParams.codecs[0];
    const videoPayloadType = videoCodec.payloadType;
    const videoClockRate = videoCodec.clockRate;
    const videoMimeType = videoCodec.mimeType.split('/')[1].toUpperCase(); // e.g., "VP8" from "video/VP8"

    let sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=BroadClass Recording
c=IN IP4 127.0.0.1
t=0 0
`;

    // Video media line - use RTP/AVP profile
    sdp += `m=video ${videoPort} RTP/AVP ${videoPayloadType}\n`;
    sdp += `a=rtpmap:${videoPayloadType} ${videoMimeType}/${videoClockRate}\n`;

    // Add codec-specific parameters (important for VP8/VP9/H264)
    if (videoCodec.parameters) {
      const fmtpParams = Object.entries(videoCodec.parameters)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      if (fmtpParams) {
        sdp += `a=fmtp:${videoPayloadType} ${fmtpParams}\n`;
      }
    }

    // SSRC is critical - tells FFmpeg which stream to expect
    if (videoSsrc) {
      sdp += `a=ssrc:${videoSsrc} cname:video\n`;
    }
    sdp += `a=recvonly\n`;

    // Audio media line (if available)
    if (audioRtpParams && audioPort) {
      const audioCodec = audioRtpParams.codecs[0];
      const audioPayloadType = audioCodec.payloadType;
      const audioClockRate = audioCodec.clockRate;
      const audioChannels = audioCodec.channels || 2;
      const audioMimeType = audioCodec.mimeType.split('/')[1].toLowerCase(); // e.g., "opus"

      sdp += `m=audio ${audioPort} RTP/AVP ${audioPayloadType}\n`;
      
      // For opus, format is: opus/48000/2
      if (audioMimeType === 'opus') {
        sdp += `a=rtpmap:${audioPayloadType} opus/${audioClockRate}/${audioChannels}\n`;
      } else {
        sdp += `a=rtpmap:${audioPayloadType} ${audioMimeType}/${audioClockRate}\n`;
      }

      if (audioCodec.parameters) {
        const fmtpParams = Object.entries(audioCodec.parameters)
          .map(([k, v]) => `${k}=${v}`)
          .join(';');
        if (fmtpParams) {
          sdp += `a=fmtp:${audioPayloadType} ${fmtpParams}\n`;
        }
      }

      if (audioSsrc) {
        sdp += `a=ssrc:${audioSsrc} cname:audio\n`;
      }
      sdp += `a=recvonly\n`;
    }

    log.debug(`Generated SDP:\n${sdp}`);
    return sdp;
  }

  /**
   * Listen for recording events from Redis (modern API)
   */
  async setupRedisListeners() {
    try {
      // Create a dedicated subscriber connection
      const subscriber = this.redisClient.client.duplicate();
      await subscriber.connect();

      await subscriber.subscribe('recording:control', (message) => {
        try {
          const event = JSON.parse(message);
          log.info(`📹 Redis recording event received:`, event);

          if (event.type === 'start') {
            log.info(`Starting recording: ${event.recordingId} for room ${event.roomId}`);
            this.startRecording(event.recordingId, event.roomId, event.filename).catch(err =>
              log.error(`Start recording failed: ${err.message}`)
            );
          } else if (event.type === 'stop') {
            log.info(`Stopping recording: ${event.recordingId}`);
            this.stopRecording(event.recordingId).catch(err =>
              log.error(`Stop recording failed: ${err.message}`)
            );
          }
        } catch (err) {
          log.error('Failed to parse recording event:', err);
        }
      });

      log.info(`✅ Subscribed to recording:control channel`);
    } catch (err) {
      log.error('Failed to setup Redis listeners:', err);
    }
  }

  /**
   * Get recording progress
   */
  getRecordingProgress(recordingId) {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return null;

    return {
      duration: Math.round((Date.now() - recording.startTime) / 1000),
      uploadedBytes: recording.totalUploadedBytes,
    };
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown() {
    log.info('Shutting down recording handler...');
    
    // Stop all active recordings
    for (const [recordingId] of this.activeRecordings) {
      try {
        await this.stopRecording(recordingId);
      } catch (err) {
        log.warn(`Failed to stop recording ${recordingId} during shutdown:`, err.message);
      }
    }

    // Cleanup S3 service (abort any pending uploads)
    await this.s3Service.cleanup();
  }
}
