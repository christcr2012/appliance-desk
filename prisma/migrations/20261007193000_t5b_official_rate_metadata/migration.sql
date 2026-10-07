-- Add official-rate metadata without changing any existing tax amount.
ALTER TABLE "TaxRateVersion"
  ADD COLUMN "autoApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoAppliedUndoneAt" TIMESTAMP(3);

ALTER TABLE "BusinessSettings"
  ADD COLUMN "autoApplyOfficialRateChanges" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoRateChangeMaxMilliPercent" INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE "TaxRateObservation" (
  "id" TEXT NOT NULL,
  "jurisdictionId" TEXT NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "rateMilliPercent" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaxRateObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfficialSourceWatch" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastHash" TEXT,
  "lastText" TEXT,
  "lastExcerpt" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "lastChangedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OfficialSourceWatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxRateObservation_jurisdictionId_asOf_idx"
  ON "TaxRateObservation"("jurisdictionId", "asOf");

CREATE INDEX "TaxRateObservation_observedAt_idx"
  ON "TaxRateObservation"("observedAt");

CREATE UNIQUE INDEX "OfficialSourceWatch_url_key"
  ON "OfficialSourceWatch"("url");

ALTER TABLE "TaxRateObservation"
  ADD CONSTRAINT "TaxRateObservation_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OfficialSourceWatch" ("id", "label", "url", "active", "updatedAt")
VALUES
  ('official-source-colorado-rate-changes', 'Colorado — Sales Tax Rate Changes', 'https://tax.colorado.gov/sales-tax-rate-changes', false, CURRENT_TIMESTAMP),
  ('official-source-colorado-dr1002', 'Colorado — DR 1002', 'https://tax.colorado.gov/DR1002', false, CURRENT_TIMESTAMP),
  ('official-source-colorado-retail-delivery-fee', 'Colorado — Retail Delivery Fee', 'https://tax.colorado.gov/retail-delivery-fee', false, CURRENT_TIMESTAMP),
  ('official-source-colorado-suts-jurisdictions', 'Colorado — SUTS Participating Jurisdictions', 'https://tax.colorado.gov/SUTS-Jurisdictions', false, CURRENT_TIMESTAMP),
  ('official-source-colorado-sales-tax-changes', 'Colorado — Sales Tax Changes', 'https://tax.colorado.gov/sales-tax-changes', false, CURRENT_TIMESTAMP),
  ('official-source-greeley-sales-tax', 'City of Greeley — Sales Tax', 'https://greeleyco.gov/business/business-operations/sales-tax/', false, CURRENT_TIMESTAMP)
ON CONFLICT ("url") DO NOTHING;
