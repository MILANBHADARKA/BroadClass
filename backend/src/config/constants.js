/**
 * Shared runtime constants.
 *
 * Anything that appears in two or more files belongs here. Anything that's
 * deployment-tunable belongs in env (see *config.js per-service); these are
 * the "physics constants" — values that, if changed, must be changed
 * everywhere or things break.
 */

// AWS S3 multipart upload requires every part except the last to be ≥ 5 MB.
// FFmpeg → S3 chunked uploads also use this as the buffer flush threshold,
// so the value has to match between producer (recordingHandler) and consumer
// (s3Service).
export const S3_MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024;
