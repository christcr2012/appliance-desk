-- Additive W-22 immutable per-agreement customer signing evidence (not a payment).
ALTER TABLE "AgreementSigningCharge"
  ADD COLUMN "frozenOrderFingerprint" TEXT,
  ADD COLUMN "frozenAllInCents" INTEGER,
  ADD COLUMN "frozenSetupTaxCents" INTEGER,
  ADD COLUMN "frozenChargeEvidence" JSONB;
ALTER TABLE "AgreementSigningCharge"
  ADD CONSTRAINT "AgreementSigningCharge_frozen_evidence_complete"
  CHECK (
    ("frozenOrderFingerprint" IS NULL AND "frozenAllInCents" IS NULL
      AND "frozenSetupTaxCents" IS NULL AND "frozenChargeEvidence" IS NULL)
    OR
    ("frozenAt" IS NOT NULL AND "frozenOrderFingerprint" IS NOT NULL
      AND length("frozenOrderFingerprint") = 64
      AND "frozenAllInCents" >= 0 AND "frozenSetupTaxCents" >= 0
      AND "frozenChargeEvidence" IS NOT NULL)
  );
