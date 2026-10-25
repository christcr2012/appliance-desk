-- Additive (MCP-1: system health that tells the truth). Three nullable typed-failure columns on AutomationRun and
-- SystemIssue, one owner setting with its starting value, and one index for bounded health reads. Nothing existing
-- is removed or rewritten; old rows keep NULL and show "Not recorded".

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "correlationId" VARCHAR(40),
ADD COLUMN     "failureCode" VARCHAR(60),
ADD COLUMN     "failureStage" VARCHAR(30);

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "automationLateGraceMinutes" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "SystemIssue" ADD COLUMN     "correlationId" VARCHAR(40),
ADD COLUMN     "failureCode" VARCHAR(60),
ADD COLUMN     "failureStage" VARCHAR(30);

-- CreateIndex
CREATE INDEX "AutomationRun_ruleKey_state_startedAt_idx" ON "AutomationRun"("ruleKey", "state", "startedAt");

-- Owner range (15 minutes to 24 hours), the same bounds the save function enforces.
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_automationLateGraceMinutes_range"
  CHECK ("automationLateGraceMinutes" >= 15 AND "automationLateGraceMinutes" <= 1440);
