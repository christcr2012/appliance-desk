-- TFA-3: turn the official-page watches on. New LegalRuleObservation table
-- (every strict-parser reading is stored and waits for the owner's
-- approval), a parserKey on each watch, the six seeded watches active,
-- three new parser-backed watches, the old rate auto-apply starting off,
-- and the master watch switch on BusinessSettings. Additive only.

CREATE TABLE "LegalRuleObservation" (
    "id" TEXT NOT NULL,
    "ruleKey" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "watchId" TEXT NOT NULL,
    "evidence" VARCHAR(1000) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "dismissNote" VARCHAR(500),
    "dismissedByUserId" TEXT,
    "approvedVersionId" TEXT,

    CONSTRAINT "LegalRuleObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegalRuleObservation_ruleKey_effectiveFrom_idx"
    ON "LegalRuleObservation"("ruleKey", "effectiveFrom");

CREATE INDEX "LegalRuleObservation_observedAt_idx"
    ON "LegalRuleObservation"("observedAt");

ALTER TABLE "LegalRuleObservation"
    ADD CONSTRAINT "LegalRuleObservation_watchId_fkey"
    FOREIGN KEY ("watchId") REFERENCES "OfficialSourceWatch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficialSourceWatch" ADD COLUMN "parserKey" TEXT;

ALTER TABLE "BusinessSettings" ADD COLUMN "watchOfficialTaxPages" BOOLEAN NOT NULL DEFAULT true;

-- The old rate auto-apply starts off: the setting's new default is false
-- and the existing singleton row is set false too. The code path stays;
-- it only runs if the owner turns the setting back on himself.
ALTER TABLE "BusinessSettings" ALTER COLUMN "autoApplyOfficialRateChanges" SET DEFAULT false;
UPDATE "BusinessSettings" SET "autoApplyOfficialRateChanges" = false;

-- Turn the six seeded watches on (starting value; the owner switch on
-- Taxes > Rules can turn watching off again).
UPDATE "OfficialSourceWatch" SET "active" = true
WHERE "id" IN (
    'official-source-colorado-rate-changes',
    'official-source-colorado-dr1002',
    'official-source-colorado-retail-delivery-fee',
    'official-source-colorado-suts-jurisdictions',
    'official-source-colorado-sales-tax-changes',
    'official-source-greeley-sales-tax'
);

UPDATE "OfficialSourceWatch" SET "parserKey" = 'GREELEY_RATE'
WHERE "id" = 'official-source-greeley-sales-tax';

INSERT INTO "OfficialSourceWatch" ("id", "label", "url", "active", "parserKey", "updatedAt")
VALUES
    ('official-source-colorado-retail-delivery-fee-rates', 'Colorado — Retail Delivery Fee Rates', 'https://tax.colorado.gov/retail-delivery-fee-rates', true, 'RDF_RATES', CURRENT_TIMESTAMP),
    ('official-source-irs-1099-instructions', 'IRS — Form 1099-MISC and 1099-NEC Instructions', 'https://www.irs.gov/instructions/i1099mec', true, 'IRS_1099_THRESHOLD', CURRENT_TIMESTAMP),
    ('official-source-colorado-penalties-interest', 'Colorado — Penalties and Interest', 'https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest', true, 'CO_INTEREST', CURRENT_TIMESTAMP)
ON CONFLICT ("url") DO NOTHING;
