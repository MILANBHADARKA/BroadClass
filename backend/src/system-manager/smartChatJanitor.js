import prisma from '../services/prisma.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('smart-chat-janitor');

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;     // every 6h
const CHAT_RETENTION_DAYS = 90;
const TRANSCRIPT_RETENTION_DAYS = 90;             // safety net for orphan transcripts

export function startSmartChatJanitor() {
  const sweep = async () => {
    const now = Date.now();
    const chatCutoff = new Date(now - CHAT_RETENTION_DAYS * 86400_000);
    const transcriptCutoff = new Date(now - TRANSCRIPT_RETENTION_DAYS * 86400_000);

    try {
      const chat = await prisma.chatMessage.deleteMany({
        where: { createdAt: { lt: chatCutoff } },
      });
      if (chat.count > 0) {
        log.warn(`Deleted ${chat.count} chat message(s) older than ${CHAT_RETENTION_DAYS} days`);
      }
    } catch (err) {
      log.error('Chat retention sweep failed:', err.message);
    }

    try {
      // Transcripts are usually cleaned via the Classroom cascade, but a
      // classroom that survives while its broadcasts age out still leaves
      // transcript rows. Drop anything past the cutoff whose broadcast has
      // ended (i.e. endedAt is set).
      const t = await prisma.transcript.deleteMany({
        where: {
          startedAt: { lt: transcriptCutoff },
          endedAt: { not: null },
        },
      });
      if (t.count > 0) {
        log.warn(`Deleted ${t.count} transcript(s) older than ${TRANSCRIPT_RETENTION_DAYS} days`);
      }
    } catch (err) {
      log.error('Transcript retention sweep failed:', err.message);
    }
  };

  sweep();
  const handle = setInterval(sweep, SWEEP_INTERVAL_MS);
  log.info(
    `Smart Chat janitor running every ${SWEEP_INTERVAL_MS / 3600_000} h — ` +
    `chat retention ${CHAT_RETENTION_DAYS}d, transcript retention ${TRANSCRIPT_RETENTION_DAYS}d`,
  );

  return { stop: () => clearInterval(handle) };
}
