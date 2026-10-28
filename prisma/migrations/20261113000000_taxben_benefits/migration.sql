-- TAXBEN-1: write-offs and tax benefits, found automatically.
-- Additive only: recorded capitalization decisions on each purchased unit, the
-- related-party answer on each purchase, the business-began fact and home-office
-- facts on the compliance profile, the mixed-use / election / enterprise-zone
-- owner settings, the self-employed health-insurance facts, and the rule-book
-- values every TAXBEN number reads (docs/research/2026-10-25-tax-benefits.md).

ALTER TABLE "Appliance"
    ADD COLUMN "capDecision" TEXT,
    ADD COLUMN "capReason" TEXT,
    ADD COLUMN "capLineCents" INTEGER,
    ADD COLUMN "capRuleKey" TEXT,
    ADD COLUMN "capRuleValue" TEXT,
    ADD COLUMN "capDecidedAt" TIMESTAMP(3),
    ADD COLUMN "capPlacedInServiceOn" TIMESTAMP(3);

ALTER TABLE "Purchase"
    ADD COLUMN "boughtFromRelatedParty" BOOLEAN;

ALTER TABLE "ComplianceProfile"
    ADD COLUMN "businessBeganOn" TIMESTAMP(3),
    ADD COLUMN "homeOfficeSqFt" INTEGER,
    ADD COLUMN "homeSqFt" INTEGER,
    ADD COLUMN "homeHousingCostsCents" INTEGER,
    ADD COLUMN "homeUtilitiesCents" INTEGER,
    ADD COLUMN "homeInsuranceCents" INTEGER,
    ADD COLUMN "homeOfficeAttestedYear" INTEGER;

ALTER TABLE "BusinessSettings"
    ADD COLUMN "businessUsePercents" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "deMinimisElections" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "enterpriseZone" TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "TaxYearFacts"
    ADD COLUMN "seHealthPremiumCents" INTEGER,
    ADD COLUMN "seHealthEmployerPlanMonths" JSONB;

INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-us-de-minimis-per-item-20260101', 'us.de_minimis_per_item', '250000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations', 'De minimis safe harbor: $2,500 per item/invoice (no audited financial statements)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-startup-costs-20260101', 'us.startup_costs', '{"deductionCents":500000,"phaseoutStartCents":5000000,"amortizationMonths":180}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/publications/p583', '26 U.S.C. 195: $5,000 deduction, reduced $1 for $1 over $50,000; rest over 180 months from the month the business begins',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-qbi-20260101', 'us.qbi', '{"percent":20,"minimumCents":40000,"minimumQbiCents":100000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/businesses/small-businesses-self-employed/qualified-business-income-deduction', 'Section 199A: 20%, permanent; $400 minimum with at least $1,000 QBI (Rev. Proc. 2025-32)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-se-tax-20260101', 'us.se_tax', '{"deductiblePercent":50,"ssWageBaseCents":18450000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/taxtopics/tc554', 'Half of SE tax deductible; applies at $400+ net earnings; SS wage base $184,500 (secondary source for the base)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-sep-ira-20260101', 'us.sep_ira', '{"percentOfNetProfit":20,"maxCents":7200000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people', 'SEP-IRA: about 20% of net profit, max $72,000; set up and fund by the return due date including extensions',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-solo-401k-20260101', 'us.solo_401k', '{"deferralCents":2450000,"maxTotalCents":7200000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people', 'Solo 401(k): $24,500 deferral plus employer share, total $72,000 for 2026',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-home-office-simplified-20260101', 'us.home_office_simplified', '{"rateCentsPerSqFt":500,"maxSqFt":300}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction', 'Home office simplified: $5/sq ft up to 300 sq ft; regular and exclusive use',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-class-life-months-20260101', 'us.class_life_months', '{"rentalAppliances":60,"tools":84}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/publications/p946', 'Rental appliances 5-year (asset class 57.0, expected — CPA confirms, DQ-TAXBEN-CLASS); tools 7-year',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-passenger-auto-caps-20260101', 'us.passenger_auto_caps', '{"year1WithBonusCents":2030000,"year1WithoutBonusCents":1230000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/publications/p946', 'Passenger auto caps 2026: year 1 $20,300 with bonus / $12,300 without (Rev. Proc. 2026-15, secondary source); trucks over 6,000 lb GVWR not capped',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-enterprise-zone-credit-20260101', 'co.enterprise_zone_credit', '{"percent":3}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://oedit.colorado.gov/enterprise-zone', 'Colorado enterprise zone investment credit: 3% of qualified investment; pre-certify BEFORE buying; Section 179 property excluded (EZ Tax Guide Apr 2026)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-bpp-exemption-20260101', 'co.bpp_exemption', '5600000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://dpt.colorado.gov/personal-property', 'Colorado business personal property exemption: $56,000 actual value per county for 2026',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now());
