-- OPS-2: refrigerant and disposal records (additive only).
CREATE TYPE "RefrigerantOutcome" AS ENUM ('RECOVERED', 'LEAKED_BEFORE');

ALTER TABLE "ApplianceType" ADD COLUMN "hasRefrigerant" BOOLEAN NOT NULL DEFAULT false;
-- Starting value: refrigerators, freezers and mini-fridges have a sealed refrigerant system. Washers and dryers do not.
UPDATE "ApplianceType" SET "hasRefrigerant" = true
  WHERE lower("name") ~ '(refrigerator|fridge|freezer)' OR lower("slug") ~ '(refrigerator|fridge|freezer)';

CREATE TABLE "RefrigerantRecord" (
  "applianceId" TEXT NOT NULL,
  "refrigerantType" TEXT NOT NULL,
  "outcome" "RefrigerantOutcome" NOT NULL,
  "recoveredByName" TEXT NOT NULL,
  "recoveredByAddress" TEXT NOT NULL,
  "certificationNumber" TEXT,
  "equipmentUsed" TEXT,
  "recoveredOn" TIMESTAMP(3) NOT NULL,
  "recyclerName" TEXT,
  "receiptReference" TEXT,
  "statementSignedAt" TIMESTAMP(3) NOT NULL,
  "statementSignedByUserId" TEXT NOT NULL,
  "signedByName" TEXT NOT NULL,
  "assetNumberSnapshot" TEXT NOT NULL,
  "applianceDescriptionSnapshot" TEXT NOT NULL,
  "serialNumberSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RefrigerantRecord_pkey" PRIMARY KEY ("applianceId")
);
CREATE INDEX "RefrigerantRecord_recoveredOn_idx" ON "RefrigerantRecord"("recoveredOn");
ALTER TABLE "RefrigerantRecord" ADD CONSTRAINT "RefrigerantRecord_applianceId_fkey"
  FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: how long to keep the record. Summary of 40 CFR 82.155 (accessed 2026-10-26): the federal rule needs the signed
-- statement for 3 years; the starting value is 6 so it matches the tax-record period. Colorado's own rule is not confirmed.
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-records-refrigerant-keep-years-20260101', 'records.refrigerant_keep_years', '6', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-82/subpart-F/section-82.155',
   'Summary of 40 CFR 82.155: a signed statement that refrigerant was removed travels with the appliance, and records are kept 3 years; 6 is the careful starting value.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now());
