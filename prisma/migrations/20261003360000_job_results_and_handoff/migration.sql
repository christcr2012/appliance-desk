-- Batch C P2-B: per-appliance completion results, job outcome, billing handoff rows, task links.
CREATE TYPE "JobApplianceResult" AS ENUM ('DELIVERED', 'NOT_DELIVERED', 'RETURNED', 'NOT_RETURNED', 'REPAIRED', 'NOT_REPAIRED', 'NO_ACCESS');
CREATE TYPE "JobApplianceRole" AS ENUM ('PRIMARY', 'REPLACEMENT');
CREATE TYPE "JobOutcome" AS ENUM ('COMPLETE', 'PARTIAL');
CREATE TYPE "HandoffKind" AS ENUM ('START_RECURRING_BILLING', 'PUSH_CREDIT');
CREATE TYPE "HandoffStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

ALTER TABLE "JobAppliance"
  ADD COLUMN "role" "JobApplianceRole" NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "result" "JobApplianceResult",
  ADD COLUMN "resultNote" TEXT,
  ADD COLUMN "resultRecordedAt" TIMESTAMP(3),
  ADD COLUMN "resultRecordedByUserId" TEXT,
  ADD COLUMN "reservationActive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Job"
  ADD COLUMN "outcome" "JobOutcome",
  ADD COLUMN "outcomeNotes" TEXT,
  ADD COLUMN "completionKey" TEXT;

ALTER TABLE "StaffTask"
  ADD COLUMN "applianceId" TEXT,
  ADD COLUMN "sourceKey" TEXT;

CREATE TABLE "JobBillingHandoff" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "HandoffKind" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobBillingHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Job_completionKey_key" ON "Job"("completionKey");
CREATE UNIQUE INDEX "StaffTask_sourceKey_key" ON "StaffTask"("sourceKey");
CREATE INDEX "StaffTask_applianceId_idx" ON "StaffTask"("applianceId");
CREATE UNIQUE INDEX "JobBillingHandoff_jobId_kind_subjectId_key" ON "JobBillingHandoff"("jobId", "kind", "subjectId");
CREATE INDEX "JobBillingHandoff_status_idx" ON "JobBillingHandoff"("status");
CREATE UNIQUE INDEX "JobAppliance_jobId_applianceId_key" ON "JobAppliance"("jobId", "applianceId");

ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobBillingHandoff" ADD CONSTRAINT "JobBillingHandoff_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One staged swap or substitution may own an appliance's RESERVED status at a time.
CREATE UNIQUE INDEX "JobAppliance_one_active_reservation" ON "JobAppliance"("applianceId") WHERE "reservationActive";

-- Replacement units of staged swaps, found the way the swap screen finds them today: the audit row written when
-- the swap reserved the unit.
UPDATE "JobAppliance" ja SET "role" = 'REPLACEMENT'
FROM "AuditLog" l
WHERE l."entityType" = 'Appliance' AND l."action" = 'appliance.unit.status' AND l."entityId" = ja."applianceId"
  AND l."newValue"->>'jobId' = ja."jobId" AND l."newValue"->>'reason' = 'Swap started' AND l."newValue"->>'status' = 'RESERVED';
