-- CMP-4: Colorado and local filings. Additive only: the ComplianceProfile
-- gains the local-filing facts (trade name, USDOT number, truck
-- registration month, Greeley license date, registered agent), and the
-- two Weld business personal property rules are seeded as researched
-- versions (the pattern of 20261101000000_legal_rules and the OPS cards).

ALTER TABLE "ComplianceProfile" ADD COLUMN "tradeName" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "usdotNumber" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "truckRegistrationMonth" INTEGER;
ALTER TABLE "ComplianceProfile" ADD COLUMN "greeleyLicenseDate" TIMESTAMP(3);
ALTER TABLE "ComplianceProfile" ADD COLUMN "registeredAgentName" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "registeredAgentAddress" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "registeredAgentCity" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "registeredAgentState" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "registeredAgentZip" TEXT;

-- Seed: researched rule versions (Weld County Assessor, accessed 2026-10-27).
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-co-bpp-exemption-threshold-20260101', 'co.bpp.exemption_threshold', '5600000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.weldgov.com/departments/assessor', 'Weld County Assessor personal property pages, 2026: no declaration schedule is required when the total actual value of a business''s personal property in the county is $56,000 or less',
   '2026-10-27T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-bpp-extension-20260101', 'co.bpp.extension', '{"tenDayFeeCents":2000,"twentyDayFeeCents":4000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.weldgov.com/departments/assessor', 'Weld County Assessor declaration schedule DS 056 instructions: an extension requested by April 15 costs $20 for 10 days or $40 for 20 days',
   '2026-10-27T12:00:00Z', true, false, NULL, NULL, now())
ON CONFLICT ("id") DO NOTHING;
