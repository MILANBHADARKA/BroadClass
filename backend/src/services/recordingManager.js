/**
 * FFmpeg Recording Manager
 * Captures broadcast stream and pipes to S3
 * 
 * Flow:
 * 1. Origin creates a consumer of broadcaster's track
 * 2. FFmpeg reads RTP stream, muxes to MP4
 * 3. Chunks streamed to S3 multipart upload
 * 4. Progress published to Redis pub/sub
 */

import { spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';

const log = createLogger('recording:manager');

export class RecordingManager {
  constructor(s3Service, redisClient) {
    this.s3Service = s3Service;
    this.redisClient = redisClient;
    this.activeRecordings = new Map(); // recordingId → { process, stream, partNumber }
  }

  /**
   * Start recording a broadcast by piping FFmpeg output to S3
   * @param {object} options
   * @param {string} options.recordingId - Recording database ID
   * @param {string} options.roomId - Broadcast room ID
   * @param {string} options.filename - Output filename
   * @param {object} options.rtp - { sdp, port } RTP stream parameters
   * @returns {Promise<void>}
   */
  async startRecording(options) {
    const { recordingId, roomId, filename, rtp } = options;

    if (this.activeRecordings.has(recordingId)) {
      throw new Error(`Recording ${recordingId} is already active`);
    }

    try {
      // 1. Initiate S3 multipart upload
      const { uploadId, s3Key } = await this.s3Service.initiateUpload(recordingId, filename);
      log.info(`📹 Starting recording: ${recordingId} (${roomId})`);

      // 2. Spawn FFmpeg process
      // Input: RTP from Origin's RTP transport
      // Output: MP4 chunks to stdout
      const ffmpegArgs = [
        '-protocol_whitelist', 'file,udp,rtp',
        '-i', rtp.sdp, // SDP description of RTP stream
        '-c:v', 'copy', // Copy video codec (no transcoding)
        '-c:a', 'copy', // Copy audio codec
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov', // Fragmented MP4 (streamable)
        'pipe:1', // Output to stdout
      ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // 3. Stream chunks from stdout to S3
      let partNumber = 1;
      let chunkBuffer = Buffer.alloc(0);
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

      ffmpeg.stdout.on('data', async (data) => {
        chunkBuffer = Buffer.concat([chunkBuffer, data]);

        // When we have enough data, upload a part
        if (chunkBuffer.length >= CHUNK_SIZE) {
          const chunk = chunkBuffer.slice(0, CHUNK_SIZE);
          chunkBuffer = chunkBuffer.slice(CHUNK_SIZE);

          try {
            await this.s3Service.uploadChunk(recordingId, chunk, partNumber, this.redisClient);
            partNumber++;
          } catch (err) {
            log.error(`Failed to upload chunk: ${err.message}`);
            this.stopRecording(recordingId);
          }
        }
      });

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg.includes('error') || msg.includes('Error')) {
          log.error(`FFmpeg: ${msg}`);
        }
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0 && code !== null) {
          log.error(`FFmpeg process exited with code ${code}`);
        }
      });

      // 4. Store recording metadata
      this.activeRecordings.set(recordingId, {
        process: ffmpeg,
        stream: ffmpeg.stdout,
        chunkBuffer,
        partNumber,
        s3Key,
        uploadId,
        roomId,
        startTime: Date.now(),
      });

      // Publish to Redis for real-time UI updates
      await this.redisClient.publish('recording:status', JSON.stringify({
        recordingId,
        roomId,
        status: 'recording_started',
        timestamp: Date.now(),
      }));

      log.info(`✅ Recording active: ${recordingId}`);
    } catch (err) {
      log.error(`Failed to start recording: ${err.message}`);
      throw err;
    }
  }

  /**
   * Stop recording and finalize S3 upload
   * @param {string} recordingId
   * @returns {Promise<object>} { duration, fileSize }
   */
  async stopRecording(recordingId) {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    try {
      // 1. Terminate FFmpeg process
      recording.process.kill('SIGTERM');

      // Wait for graceful shutdown (2 seconds max)
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          recording.process.kill('SIGKILL');
          resolve();
        }, 2000);

        recording.process.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // 2. Upload final chunk if any
      if (recording.chunkBuffer.length > 0) {
        await this.s3Service.uploadChunk(
          recordingId,
          recording.chunkBuffer,
          recording.partNumber,
          this.redisClient
        );
      }

      // 3. Complete multipart upload
      const result = await this.s3Service.completeUpload(recordingId);
      const duration = Math.round((Date.now() - recording.startTime) / 1000);

      this.activeRecordings.delete(recordingId);

      // Publish completion
      await this.redisClient.publish('recording:status', JSON.stringify({
        recordingId,
        roomId: recording.roomId,
        status: 'recording_completed',
        duration,
        fileSize: result.fileSize,
        timestamp: Date.now(),
      }));

      log.info(`✅ Recording finalized: ${recordingId} (${duration}s, ${(result.fileSize / (1024 * 1024)).toFixed(1)} MB)`);

      return {
        duration,
        fileSize: result.fileSize,
        s3Url: result.location,
        s3Key: result.key,
      };
    } catch (err) {
      log.error(`Failed to stop recording: ${err.message}`);
      this.activeRecordings.delete(recordingId);
      throw err;
    }
  }

  /**
   * Get recording progress
   * @param {string} recordingId
   * @returns {object} { duration, uploadedBytes, progress% } or null
   */
  getRecordingProgress(recordingId) {
    const recording = this.activeRecordings.get(recordingId);
    if (!recording) return null;

    const s3Progress = this.s3Service.getUploadProgress(recordingId);
    return {
      uploadedBytes: s3Progress?.uploadedBytes || 0,
      duration: Math.round((Date.now() - recording.startTime) / 1000),
    };
  }

  /**
   * Cleanup: stop all active recordings
   */
  async cleanup() {
    const recordingIds = Array.from(this.activeRecordings.keys());
    for (const recordingId of recordingIds) {
      try {
        await this.stopRecording(recordingId);
      } catch (err) {
        log.error(`Cleanup failed for ${recordingId}: ${err.message}`);
      }
    }
  }
}

export default RecordingManager;
