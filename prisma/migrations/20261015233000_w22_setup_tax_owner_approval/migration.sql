-- Additive, nullable provenance for the owner's CPA-backed setup tax decision.
-- Existing decided text settings deliberately remain unusable until re-confirmed.
ALTER TABLE "BusinessSettings"
  ADD COLUMN "setupFeeTaxPlanningTreatment" TEXT NOT NULL DEFAULT 'TAXABLE',
  ADD COLUMN "setupFeeTaxConfirmedOn" TIMESTAMP(3),
  ADD COLUMN "setupFeeTaxEffectiveFrom" TIMESTAMP(3),
  ADD COLUMN "setupFeeTaxApprovedAt" TIMESTAMP(3),
  ADD COLUMN "setupFeeTaxAdviserReference" TEXT;


-- Durable, successive owner-reviewed CPA policy versions. Never backfill
-- synthetic professional confirmations for a legacy free-text choice.
CREATE TABLE "SetupFeeTaxDecisionVersion" (
  "id" TEXT NOT NULL,
  "effectiveFromKey" TEXT NOT NULL,
  "cpaConfirmedOnKey" TEXT,
  "treatment" TEXT NOT NULL,
  "decisionNote" TEXT,
  "adviserReference" TEXT,
  "ownerApprovedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerUserId" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SetupFeeTaxDecisionVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SetupFeeTaxDecisionVersion_effectiveFromKey_ownerApprovedAt_idx"
  ON "SetupFeeTaxDecisionVersion"("effectiveFromKey", "ownerApprovedAt");
