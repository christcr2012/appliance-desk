-- Business paperwork tracker (owner-only). Additive, zero-data migration; no existing table changes.
CREATE TYPE "PaperworkStatus" AS ENUM ('TO_DO', 'IN_PROGRESS', 'DONE', 'NOT_NEEDED');

CREATE TABLE "BusinessPaperwork" (
  "id" TEXT NOT NULL,
  "templateKey" TEXT,
  "title" TEXT NOT NULL,
  "groupName" TEXT NOT NULL,
  "whatItIs" TEXT,
  "agency" TEXT,
  "officialUrl" TEXT,
  "status" "PaperworkStatus" NOT NULL DEFAULT 'TO_DO',
  "referenceNumber" TEXT,
  "startedOn" TIMESTAMP(3),
  "dueOn" TIMESTAMP(3),
  "remindDaysBefore" INTEGER NOT NULL DEFAULT 30,
  "repeatEveryMonths" INTEGER,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "lastDoneOn" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "BusinessPaperwork_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessPaperwork_remind_check" CHECK ("remindDaysBefore" BETWEEN 0 AND 365),
  CONSTRAINT "BusinessPaperwork_repeat_check" CHECK ("repeatEveryMonths" IS NULL OR "repeatEveryMonths" BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "BusinessPaperwork_templateKey_key" ON "BusinessPaperwork"("templateKey");
CREATE INDEX "BusinessPaperwork_status_dueOn_idx" ON "BusinessPaperwork"("status", "dueOn");
