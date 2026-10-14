-- Additive, nullable provenance for the owner's CPA-backed setup tax decision.
-- Existing decided text settings deliberately remain unusable until re-confirmed.
ALTER TABLE "BusinessSettings"
  ADD COLUMN "setupFeeTaxPlanningTreatment" TEXT NOT NULL DEFAULT 'TAXABLE',
  ADD COLUMN "setupFeeTaxConfirmedOn" TIMESTAMP(3),
  ADD COLUMN "setupFeeTaxEffectiveFrom" TIMESTAMP(3),
  ADD COLUMN "setupFeeTaxApprovedAt" TIMESTAMP(3),
  ADD COLUMN "setupFeeTaxAdviserReference" TEXT;
