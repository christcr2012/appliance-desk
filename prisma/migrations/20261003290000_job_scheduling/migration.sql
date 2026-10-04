-- Batch C P1-A: who does a visit, how long it takes, and a version counter for stale-save protection.
ALTER TABLE "Job" ADD COLUMN "assignedToUserId" TEXT, ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "noShowAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD CONSTRAINT "Job_durationMinutes_range"
  CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 15 AND 720);
ALTER TABLE "BusinessSettings" ADD COLUMN "defaultJobDurationMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_defaultJobDuration_range"
  CHECK ("defaultJobDurationMinutes" BETWEEN 15 AND 720);
CREATE INDEX "Job_assignedToUserId_scheduledAt_idx" ON "Job"("assignedToUserId","scheduledAt");
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId")
  REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
