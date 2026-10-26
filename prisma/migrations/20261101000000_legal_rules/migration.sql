-- TFA-1: dated legal-rule versions (TAX-FEE-AUTOPILOT section 1).
-- Every legal number the desk relies on becomes a version with its source, so a
-- bill for an old date is always priced by the rule of its own date. Nothing is
-- overwritten: a late change is true-up'd against the version that should have
-- applied, never by rewriting issued bills.
-- Additive only: new table/enum/columns, seeded rows, one copied history.
-- Seeded values come from docs/research/2026-10-25-tax-fee-rules.md (accessed
-- 2026-10-25). Rules with no explicit start in the research file are seeded
-- from 2026-01-01 (Denver midnight); bonus depreciation from 2025-01-20 (its
-- value already encodes the Jan 19, 2025 boundary). Rules with no URL in the
-- research file seed sourceUrl NULL and name the document in sourceQuote;
-- no URL was invented.
-- Existing RetailDeliveryFeeRate rows are copied into OWNER versions (not
-- confirmed = false) with effectiveFrom normalised to the Denver midnight of
-- the rate's effective date, so an owner-entered rate and a researched seed
-- for the same July 1 share one instant and the origin priority
-- (PROFESSIONAL > OWNER > OFFICIAL_WATCH > RESEARCHED) decides.

-- CreateEnum
CREATE TYPE "LegalRuleOrigin" AS ENUM ('RESEARCHED', 'OFFICIAL_WATCH', 'OWNER', 'PROFESSIONAL');

-- CreateTable
CREATE TABLE "LegalRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleKey" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "origin" "LegalRuleOrigin" NOT NULL,
    "sourceUrl" VARCHAR(500),
    "sourceQuote" VARCHAR(1000),
    "checkedOn" TIMESTAMP(3),
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "autoApplied" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Uniqueness is one ACTIVE version per (ruleKey, effectiveFrom, origin):
-- an undone version stays as history and must not block a replacement for
-- the same start date (Codex review on PR #617: saving a second value for a
-- date, or replacing an undone change, failed on the unique key). Prisma
-- cannot express a partial unique index, so it lives here in SQL only (the
-- same pattern as DecisionScheduledChange_one_pending_per_subject, DEC-1a);
-- there is no @@unique on LegalRuleVersion in the schema.
CREATE UNIQUE INDEX "LegalRuleVersion_one_active_per_key_date_origin" ON "LegalRuleVersion"("ruleKey", "effectiveFrom", "origin") WHERE "undoneAt" IS NULL;
CREATE INDEX "LegalRuleVersion_ruleKey_effectiveFrom_idx" ON "LegalRuleVersion"("ruleKey", "effectiveFrom");

-- AlterTable: the dated rule version that set the amount on new RDF records.
ALTER TABLE "RetailDeliveryFeeRecord" ADD COLUMN "ruleVersionId" TEXT;
ALTER TABLE "RetailDeliveryFeeRecord" ADD CONSTRAINT "RetailDeliveryFeeRecord_ruleVersionId_fkey"
  FOREIGN KEY ("ruleVersionId") REFERENCES "LegalRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A READY record's evidence is a rule version as well as a rate row: the old
-- check demanded rateId, so a READY record written by the new rule readers
-- (ruleVersionId set, rateId null) was refused by the database. Relax it to
-- either parent. (Found by the PR #617 CI run: the rules-as-of and RDF
-- integration tests failed on this check.)
ALTER TABLE "RetailDeliveryFeeRecord" DROP CONSTRAINT "RetailDeliveryFeeRecord_ready_requires_evidence";
ALTER TABLE "RetailDeliveryFeeRecord" ADD CONSTRAINT "RetailDeliveryFeeRecord_ready_requires_evidence" CHECK (
  "status" <> 'READY' OR
  ("saleOn" IS NOT NULL AND ("rateId" IS NOT NULL OR "ruleVersionId" IS NOT NULL) AND "amountCents" IS NOT NULL)
);

-- AlterTable: timing for changes that cost the business (TFA-1 section 3).
-- Starting values 90% and 3 business days (owner choice, Oct 25, 2026).
ALTER TABLE "BusinessSettings" ADD COLUMN "costlyChangeTimingPercent" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "BusinessSettings" ADD COLUMN "timingSafetyMarginBusinessDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_costlyChangeTimingPercent_check"
  CHECK ("costlyChangeTimingPercent" >= 85 AND "costlyChangeTimingPercent" <= 95);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_timingSafetyMarginBusinessDays_check"
  CHECK ("timingSafetyMarginBusinessDays" >= 1 AND "timingSafetyMarginBusinessDays" <= 10);

-- Seed: the books account for tax/fee the business pays when a change lands late.
INSERT INTO "LedgerAccount" ("id", "systemRole", "name", "type", "description", "isPaymentSource", "active", "sortOrder", "createdAt", "updatedAt")
VALUES ('k_seed_tax_absorbed', 'TAX_ABSORBED', 'Tax/fee the business paid for a late change', 'EXPENSE',
  'Tax/fee the business paid for a late change', false, true, 999, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- Copy owner-entered RDF rates into OWNER versions (effectiveFrom normalised to
-- the Denver midnight of the rate's effective date).
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
SELECT 'rule-rdf-copy-' || "id", 'co.rdf.amount', to_jsonb("amountCents"),
  (date_trunc('day', "effectiveOn" AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver'),
  'OWNER', NULL, NULL, "createdAt", false, false, NULL, "enteredByUserId", now()
FROM "RetailDeliveryFeeRate";

-- Seed: researched rule versions (docs/research/2026-10-25-tax-fee-rules.md).
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-co-rdf-amount-20230701', 'co.rdf.amount', '28', '2023-07-01T06:00:00Z', 'RESEARCHED',
   'https://tax.colorado.gov/retail-delivery-fee-rates', 'DR 1786 2026: Jul 2023–Jun 2024 $0.28',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-rdf-amount-20240701', 'co.rdf.amount', '29', '2024-07-01T06:00:00Z', 'RESEARCHED',
   'https://tax.colorado.gov/retail-delivery-fee-rates', 'DR 1786 2026: Jul 2024–Jun 2025 $0.29',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-rdf-amount-20250701', 'co.rdf.amount', '28', '2025-07-01T06:00:00Z', 'RESEARCHED',
   'https://tax.colorado.gov/retail-delivery-fee-rates', 'DR 1786 2026: Jul 2025–Jun 2026 $0.28',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-rdf-amount-20260701', 'co.rdf.amount', '31', '2026-07-01T06:00:00Z', 'RESEARCHED',
   'https://tax.colorado.gov/retail-delivery-fee-rates', 'DR 1786 2026: Jul 2026–Jun 2027 $0.31',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-rdf-qualified-threshold-20230504', 'co.rdf.qualified_threshold', '50000000', '2023-05-04T06:00:00Z', 'RESEARCHED',
   NULL, 'C.R.S. 43-4-218: prior calendar year Colorado retail sales ≤ $500,000',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-sales-frequency-thresholds-20260101', 'co.sales.frequency_thresholds', '{"annualMaxMonthlyCents":5000,"quarterlyMaxMonthlyCents":110000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'Sales Tax Guide May 2026 p.19: quarterly when average tax under $1,100 and over $50/month; annual when $50 or less',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-sales-state-service-fee-20260101', 'co.sales.state_service_fee', '0', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'Service (vendor) fee: none on state sales tax from Jan 1, 2026',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-use-monthly-threshold-20260101', 'co.use.monthly_threshold', '30000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'DR 0252 (2026): under $300/year one return; over $300 at any month end → monthly',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-penalty-20260101', 'co.penalty', '{"minCents":1500,"firstPercent":10,"perMonthPercent":0.5,"maxPercent":18}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest', 'Late: greater of $15 or 10% + 0.5%/month (max 18%)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-interest-20260101', 'co.interest', '{"regular":11,"discounted":8}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest', '2026 interest 11% regular, 8% discounted',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-lease-short-term-months-20260101', 'co.lease.short_term_months', '36', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'Leases Jul 2026: short-term lease is 36 months or less',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-license-expiry-20260101', 'co.license.expiry', '{"rule":"DEC_31_ODD_YEARS"}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'License expires December 31 of odd years (next 12/31/2027)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-1099-threshold-20260101', 'us.1099.threshold', '200000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, '1099: $2,000 for payments in tax years after 2025',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-1099-deadlines-20260101', 'us.1099.deadlines', '{"necBoth":"01-31","miscPayee":"01-31","miscIrsPaper":"02-28","miscIrsElectronic":"03-31"}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, '1099-NEC to payee and IRS by Jan 31; 1099-MISC to payee Jan 31, to IRS Feb 28 (paper) / Mar 31 (electronic)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-section179-20260101', 'us.section179', '{"limitCents":256000000,"phaseoutCents":409000000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'Section 179 2026: limit $2,560,000, phase-out from $4,090,000',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-bonus-depreciation-20250120', 'us.bonus_depreciation', '{"percent":100,"acquiredAfter":"2025-01-19"}', '2025-01-20T07:00:00Z', 'RESEARCHED',
   NULL, 'Bonus depreciation 100% for property acquired after Jan 19, 2025',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-records-keep-years-20260101', 'records.keep_years', '7', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, '7 years for bad-debt claims; property records until the limit runs for the year it is disposed of',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-greeley-sales-rate-20260101', 'greeley.sales_rate', '4110', '2026-01-01T07:00:00Z', 'RESEARCHED',
   NULL, 'Greeley address: state 2.9% + Greeley 4.11% (Weld County none, not in RTD) = 7.01%',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now());

-- Carry over the owner's existing settings (Codex review on PR #617): the
-- readers stop consulting these four BusinessSettings fields, so a setting
-- the owner already changed would silently stop taking effect. Each becomes
-- an OWNER version from 2026-01-01, so it wins over the researched seed at
-- the same date (origin priority) until the owner changes it. A later save
-- for the same date supersedes it (see saveRuleVersionInTx). Only a value
-- the owner actually changed is carried: the init migration seeds
-- BusinessSettings with the schema defaults, so without the "<> default"
-- guard every fresh database would gain default-valued OWNER rows that
-- occupy the (ruleKey, effectiveFrom, OWNER) slot and block any later
-- version for the same date. A value equal to the default needs no OWNER
-- row — the researched seed already has it.
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
SELECT 'rule-carry-records-keep-years', 'records.keep_years', to_jsonb("recordRetentionYears"),
  '2026-01-01T07:00:00Z', 'OWNER', NULL,
  'Carried from your previous setting when the rule book was created (TFA-1).',
  now(), false, false, NULL, NULL, now()
FROM "BusinessSettings" WHERE "recordRetentionYears" IS NOT NULL AND "recordRetentionYears" <> 7;
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
SELECT 'rule-carry-use-monthly-threshold', 'co.use.monthly_threshold', to_jsonb("useTaxMonthlyThresholdCents"),
  '2026-01-01T07:00:00Z', 'OWNER', NULL,
  'Carried from your previous setting when the rule book was created (TFA-1).',
  now(), false, false, NULL, NULL, now()
FROM "BusinessSettings" WHERE "useTaxMonthlyThresholdCents" IS NOT NULL AND "useTaxMonthlyThresholdCents" <> 30000;
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
SELECT 'rule-carry-rdf-qualified-threshold', 'co.rdf.qualified_threshold', to_jsonb("rdfThresholdCents"),
  '2026-01-01T07:00:00Z', 'OWNER', NULL,
  'Carried from your previous setting when the rule book was created (TFA-1).',
  now(), false, false, NULL, NULL, now()
FROM "BusinessSettings" WHERE "rdfThresholdCents" IS NOT NULL AND "rdfThresholdCents" <> 50000000;
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
SELECT 'rule-carry-1099-threshold', 'us.1099.threshold', to_jsonb("vendor1099ThresholdCents"),
  '2026-01-01T07:00:00Z', 'OWNER', NULL,
  'Carried from your previous setting when the rule book was created (TFA-1).',
  now(), false, false, NULL, NULL, now()
FROM "BusinessSettings" WHERE "vendor1099ThresholdCents" IS NOT NULL AND "vendor1099ThresholdCents" <> 200000;
