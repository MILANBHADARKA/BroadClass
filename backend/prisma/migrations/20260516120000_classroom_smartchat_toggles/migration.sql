-- Smart Chat per-classroom toggles (Phase 5).
-- Defaults ON: existing classrooms keep the behavior they had before this
-- migration shipped. Teachers can opt out per classroom from the UI.

ALTER TABLE "Classroom"
  ADD COLUMN "aiChatEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "transcriptionEnabled" BOOLEAN NOT NULL DEFAULT true;
