-- W-22C6B stores the signing evidence separate from private draft charges.
-- Nullable to preserve historical signatures; new send/sign must require proof.
ALTER TABLE "SignatureRecord"
  ADD COLUMN "signingOrderFingerprint" TEXT,
  ADD COLUMN "signingAllInCents" INTEGER,
  ADD COLUMN "signingEvidenceVersion" INTEGER;
ALTER TABLE "SignatureRecord"
  ADD CONSTRAINT "SignatureRecord_signing_evidence_complete"
  CHECK (
    ("signingOrderFingerprint" IS NULL AND "signingAllInCents" IS NULL
      AND "signingEvidenceVersion" IS NULL)
    OR
    ("signingOrderFingerprint" IS NOT NULL
      AND length("signingOrderFingerprint") = 64
      AND "signingAllInCents" >= 0 AND "signingEvidenceVersion" = 1)
  );
