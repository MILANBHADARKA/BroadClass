-- Phase 8: Session-scoped Smart Chat
--
-- Adds the BroadcastSession table and a sessionId FK on the four tables
-- that hold time-bounded lecture state: Transcript, TranscriptChunk,
-- ChatMessage, Recording.
--
-- Strategy: add columns nullable, backfill with a synthetic session row
-- per existing distinct broadcastId, then promote to NOT NULL + FK. Drop
-- the now-stale broadcastId indexes; create the sessionId-based ones.

-- ── 1. Create BroadcastSession ────────────────────────────────────────
CREATE TABLE "BroadcastSession" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "broadcasterId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "BroadcastSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BroadcastSession_classroomId_startedAt_idx"
    ON "BroadcastSession"("classroomId", "startedAt" DESC);
CREATE INDEX "BroadcastSession_broadcasterId_startedAt_idx"
    ON "BroadcastSession"("broadcasterId", "startedAt" DESC);

ALTER TABLE "BroadcastSession"
    ADD CONSTRAINT "BroadcastSession_classroomId_fkey"
    FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BroadcastSession"
    ADD CONSTRAINT "BroadcastSession_broadcasterId_fkey"
    FOREIGN KEY ("broadcasterId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Backfill: one synthetic BroadcastSession per existing broadcastId ─
-- Each historical broadcastId (= classroomId by app convention) becomes a
-- single "legacy session" so we can FK to it. The legacy session's
-- broadcasterId is the classroom's teacher.
WITH legacy_broadcasts AS (
    SELECT DISTINCT "broadcastId" AS bid
    FROM "Transcript"
    UNION
    SELECT DISTINCT "broadcastId" FROM "TranscriptChunk"
    UNION
    SELECT DISTINCT "broadcastId" FROM "ChatMessage"
    UNION
    SELECT DISTINCT "broadcastId" FROM "Recording" WHERE "broadcastId" IS NOT NULL
)
INSERT INTO "BroadcastSession" ("id", "classroomId", "broadcasterId", "title", "startedAt", "endedAt")
SELECT
    gen_random_uuid()::text AS id,
    c."id" AS classroomId,
    c."teacherId" AS broadcasterId,
    'Legacy session (pre-Phase-8)' AS title,
    -- Use the earliest transcript/chat/recording row's timestamp if we can find one.
    COALESCE(
        (SELECT MIN("startedAt") FROM "Transcript" WHERE "broadcastId" = lb.bid),
        (SELECT MIN("createdAt") FROM "ChatMessage" WHERE "broadcastId" = lb.bid),
        (SELECT MIN("recordingStarted") FROM "Recording" WHERE "broadcastId" = lb.bid),
        CURRENT_TIMESTAMP
    ) AS startedAt,
    CURRENT_TIMESTAMP AS endedAt   -- mark all legacy sessions as already ended
FROM legacy_broadcasts lb
JOIN "Classroom" c ON c."id" = lb.bid;

-- ── 3. Transcript: add sessionId, backfill, lock down ───────────────────
ALTER TABLE "Transcript" ADD COLUMN "sessionId" TEXT;

UPDATE "Transcript" t
SET "sessionId" = (
    SELECT bs."id" FROM "BroadcastSession" bs
    WHERE bs."classroomId" = t."broadcastId"
      AND bs."title" = 'Legacy session (pre-Phase-8)'
    LIMIT 1
);

ALTER TABLE "Transcript" ALTER COLUMN "sessionId" SET NOT NULL;
ALTER TABLE "Transcript"
    ADD CONSTRAINT "Transcript_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "BroadcastSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Transcript_broadcastId_idx";
CREATE INDEX "Transcript_sessionId_idx" ON "Transcript"("sessionId");

-- ── 4. TranscriptChunk: same pattern ────────────────────────────────────
ALTER TABLE "TranscriptChunk" ADD COLUMN "sessionId" TEXT;

UPDATE "TranscriptChunk" tc
SET "sessionId" = (
    SELECT bs."id" FROM "BroadcastSession" bs
    WHERE bs."classroomId" = tc."broadcastId"
      AND bs."title" = 'Legacy session (pre-Phase-8)'
    LIMIT 1
);

ALTER TABLE "TranscriptChunk" ALTER COLUMN "sessionId" SET NOT NULL;
ALTER TABLE "TranscriptChunk"
    ADD CONSTRAINT "TranscriptChunk_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "BroadcastSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "TranscriptChunk_broadcastId_idx";
CREATE INDEX "TranscriptChunk_sessionId_idx" ON "TranscriptChunk"("sessionId");

-- ── 5. ChatMessage: same pattern ────────────────────────────────────────
ALTER TABLE "ChatMessage" ADD COLUMN "sessionId" TEXT;

UPDATE "ChatMessage" cm
SET "sessionId" = (
    SELECT bs."id" FROM "BroadcastSession" bs
    WHERE bs."classroomId" = cm."classroomId"
      AND bs."title" = 'Legacy session (pre-Phase-8)'
    LIMIT 1
);

ALTER TABLE "ChatMessage" ALTER COLUMN "sessionId" SET NOT NULL;
ALTER TABLE "ChatMessage"
    ADD CONSTRAINT "ChatMessage_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "BroadcastSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "ChatMessage_broadcastId_createdAt_idx";
DROP INDEX IF EXISTS "ChatMessage_broadcastId_status_idx";
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");
CREATE INDEX "ChatMessage_sessionId_status_idx" ON "ChatMessage"("sessionId", "status");

-- ── 6. Recording: sessionId stays NULLABLE (legacy recordings have no session) ─
ALTER TABLE "Recording" ADD COLUMN "sessionId" TEXT;

UPDATE "Recording" r
SET "sessionId" = (
    SELECT bs."id" FROM "BroadcastSession" bs
    WHERE bs."classroomId" = r."classroomId"
      AND bs."title" = 'Legacy session (pre-Phase-8)'
    LIMIT 1
)
WHERE r."broadcastId" IS NOT NULL;

ALTER TABLE "Recording"
    ADD CONSTRAINT "Recording_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "BroadcastSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Recording_sessionId_idx" ON "Recording"("sessionId");
