-- Additive (older review findings: stored-file clean-up). One new table; nothing existing is changed.
CREATE TABLE "StoredFileCleanup" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleteAfter" TIMESTAMP(3) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'WAITING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "finishedAt" TIMESTAMP(3),
  "note" TEXT,
  CONSTRAINT "StoredFileCleanup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoredFileCleanup_state_check" CHECK ("state" IN ('WAITING', 'DELETED', 'KEPT', 'FAILED'))
);
CREATE UNIQUE INDEX "StoredFileCleanup_url_key" ON "StoredFileCleanup"("url");
CREATE INDEX "StoredFileCleanup_state_deleteAfter_idx" ON "StoredFileCleanup"("state", "deleteAfter");

-- Owner-editable waiting periods before a removed file is deleted (starting values 30 days and 1 day).
ALTER TABLE "BusinessSettings" ADD COLUMN "receiptFileKeepDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "unsentPhotoKeepDays" INTEGER NOT NULL DEFAULT 1;
