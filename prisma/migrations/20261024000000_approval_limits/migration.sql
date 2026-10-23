-- Additive (Batch O-3). Approval limits start OFF: the thresholds default to {} so nobody needs approval until the owner
-- sets a limit. One new table, two enums, two defaulted settings columns.
CREATE TYPE "ApprovalKind" AS ENUM ('REFUND', 'CREDIT', 'WRITE_OFF', 'DEPOSIT_KEPT', 'EXPENSE');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED', 'FAILED');

ALTER TABLE "BusinessSettings" ADD COLUMN "approvalThresholds" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "BusinessSettings" ADD COLUMN "approvalExpiryDays" INTEGER NOT NULL DEFAULT 7;

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL,
  "kind" "ApprovalKind" NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "targetRef" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "summary" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "executedAt" TIMESTAMP(3),
  "resultRef" TEXT,
  "failureMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalRequest_amount_check" CHECK ("amountCents" >= 0)
);
CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");
CREATE INDEX "ApprovalRequest_kind_targetRef_status_idx" ON "ApprovalRequest"("kind", "targetRef", "status");
-- One waiting request per thing, so a double click or a second admin cannot stack requests.
CREATE UNIQUE INDEX "ApprovalRequest_one_pending_per_target" ON "ApprovalRequest"("kind", "targetRef") WHERE "status" = 'PENDING';
