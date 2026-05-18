-- Smart Chat (Live Transcription + RAG) foundations
-- Adds: pgvector extension, Transcript, TranscriptChunk, ChatMessage, ChatUpvote
-- plus the two enums ChatRole and ChatStatus and an ivfflat index on
-- TranscriptChunk.embedding for cosine similarity search.

-- Ensure pgvector is available before declaring vector columns/indexes.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('VIEWER_QUESTION', 'AI_ANSWER', 'TEACHER_ANSWER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM (
    'VISIBLE',
    'AWAITING_TEACHER',
    'ANSWERED_BY_TEACHER',
    'HIDDEN_BY_MODERATION',
    'HIDDEN_BY_TEACHER'
);

-- CreateTable: Transcript (parent row per broadcast session)
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "language" TEXT,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Transcript_broadcastId_idx" ON "Transcript"("broadcastId");
CREATE INDEX "Transcript_classroomId_startedAt_idx" ON "Transcript"("classroomId", "startedAt");

-- CreateTable: TranscriptChunk (the searchable units)
-- embedding column type uses vector(384) from pgvector.
CREATE TABLE "TranscriptChunk" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "embedding" vector(384),
    "embeddingVersion" TEXT NOT NULL DEFAULT 'st-MiniLM-L6-v2-v1',
    "speakerLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TranscriptChunk_transcriptId_chunkIndex_idx" ON "TranscriptChunk"("transcriptId", "chunkIndex");
CREATE INDEX "TranscriptChunk_broadcastId_idx" ON "TranscriptChunk"("broadcastId");

-- Vector similarity index (ivfflat, cosine distance). lists=100 is a reasonable
-- starting point; tune once data volume is known (rule of thumb: rows/1000).
CREATE INDEX "TranscriptChunk_embedding_idx" ON "TranscriptChunk"
    USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- CreateTable: ChatMessage (questions, AI/teacher answers, system notices)
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "status" "ChatStatus" NOT NULL DEFAULT 'VISIBLE',
    "broadcastMs" INTEGER,
    "aiConfidence" TEXT,
    "sourceChunkIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moderationFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_broadcastId_createdAt_idx" ON "ChatMessage"("broadcastId", "createdAt");
CREATE INDEX "ChatMessage_broadcastId_status_idx" ON "ChatMessage"("broadcastId", "status");
CREATE INDEX "ChatMessage_parentId_idx" ON "ChatMessage"("parentId");

-- CreateTable: ChatUpvote (one row per user per question)
CREATE TABLE "ChatUpvote" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatUpvote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatUpvote_messageId_userId_key" ON "ChatUpvote"("messageId", "userId");
CREATE INDEX "ChatUpvote_messageId_idx" ON "ChatUpvote"("messageId");
CREATE INDEX "ChatUpvote_userId_idx" ON "ChatUpvote"("userId");

-- Foreign keys
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_classroomId_fkey"
    FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptChunk" ADD CONSTRAINT "TranscriptChunk_transcriptId_fkey"
    FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- parentId: SET NULL on delete (preserve answer history if a question is hard-deleted)
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ChatMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatUpvote" ADD CONSTRAINT "ChatUpvote_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatUpvote" ADD CONSTRAINT "ChatUpvote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
