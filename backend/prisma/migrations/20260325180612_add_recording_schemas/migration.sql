-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('PRIVATE', 'CLASSROOM', 'PUBLIC');

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "broadcastId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Untitled Recording',
    "description" TEXT,
    "s3Key" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "fileSize" BIGINT NOT NULL DEFAULT 0,
    "status" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
    "accessType" "AccessType" NOT NULL DEFAULT 'PRIVATE',
    "expiresAt" TIMESTAMP(3),
    "recordingStarted" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordingEnded" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingPermission" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'view',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT NOT NULL,

    CONSTRAINT "RecordingPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recording_s3Key_key" ON "Recording"("s3Key");

-- CreateIndex
CREATE INDEX "Recording_classroomId_idx" ON "Recording"("classroomId");

-- CreateIndex
CREATE INDEX "Recording_teacherId_idx" ON "Recording"("teacherId");

-- CreateIndex
CREATE INDEX "Recording_status_idx" ON "Recording"("status");

-- CreateIndex
CREATE INDEX "Recording_recordingStarted_idx" ON "Recording"("recordingStarted");

-- CreateIndex
CREATE INDEX "RecordingPermission_recordingId_idx" ON "RecordingPermission"("recordingId");

-- CreateIndex
CREATE INDEX "RecordingPermission_userId_idx" ON "RecordingPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordingPermission_recordingId_userId_key" ON "RecordingPermission"("recordingId", "userId");

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingPermission" ADD CONSTRAINT "RecordingPermission_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingPermission" ADD CONSTRAINT "RecordingPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingPermission" ADD CONSTRAINT "RecordingPermission_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
