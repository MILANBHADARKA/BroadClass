-- CreateIndex
CREATE INDEX "Recording_classroomId_status_idx" ON "Recording"("classroomId", "status");

-- CreateIndex
CREATE INDEX "Recording_teacherId_recordingStarted_idx" ON "Recording"("teacherId", "recordingStarted");
