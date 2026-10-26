-- OPS-7: privacy and security duties (additive only).
CREATE TYPE "SecurityIncidentState" AS ENUM ('OPEN', 'CLOSED');

ALTER TABLE "BusinessSettings"
  ADD COLUMN "retentionAgreementYears" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "retentionTaxYears" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "retentionRefrigerantYears" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "retentionLeadYears" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "retentionMessageYears" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "retentionPurgeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "faceMatchIdEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketingTextStartHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "marketingTextEndHour" INTEGER NOT NULL DEFAULT 21,
  ADD COLUMN "vendorReviewMonths" INTEGER NOT NULL DEFAULT 12;

ALTER TABLE "Customer"
  ADD COLUMN "legalHoldAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldReason" TEXT;

CREATE TABLE "SecurityIncident" (
  "id" TEXT NOT NULL,
  "state" "SecurityIncidentState" NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "discoveredAt" TIMESTAMP(3) NOT NULL,
  "determinedAt" TIMESTAMP(3),
  "residentsAffected" INTEGER,
  "openedByUserId" TEXT NOT NULL,
  "residentsNotifiedAt" TIMESTAMP(3),
  "attorneyGeneralNotifiedAt" TIMESTAMP(3),
  "bureausNotifiedAt" TIMESTAMP(3),
  "vendorsNotifiedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closedNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SecurityIncident_state_discoveredAt_idx" ON "SecurityIncident"("state", "discoveredAt");

CREATE TABLE "ServiceVendor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "whatTheyDo" TEXT NOT NULL,
  "dataTheyHold" TEXT NOT NULL,
  "termsReviewedOn" TIMESTAMP(3),
  "termsReviewedByUserId" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceVendor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceVendor_name_key" ON "ServiceVendor"("name");

CREATE TABLE "AccessibilityComplaint" (
  "id" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "fromWho" TEXT,
  "description" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessibilityComplaint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessibilityComplaint_resolvedAt_receivedAt_idx" ON "AccessibilityComplaint"("resolvedAt", "receivedAt");

-- The service providers the app depends on (names only; no account details). "Not reviewed yet" until the owner records a date.
INSERT INTO "ServiceVendor" ("id", "name", "whatTheyDo", "dataTheyHold", "updatedAt") VALUES
  ('vendor-vercel', 'Vercel', 'Runs the website and the desk', 'Everything the app shows and stores while it runs', now()),
  ('vendor-neon', 'Neon', 'Holds the database', 'Customer records, agreements, bills, messages', now()),
  ('vendor-stripe', 'Stripe', 'Takes card and bank payments', 'Payment details (we never see full card numbers)', now()),
  ('vendor-google', 'Google Workspace', 'Business email and files', 'Business email and shared files', now()),
  ('vendor-twilio', 'Twilio', 'Sends and receives texts and calls', 'Phone numbers and message text', now()),
  ('vendor-resend', 'Resend', 'Sends email from the app', 'Email addresses and message text', now());

-- Seed: breach and accessibility timing (accessed 2026-10-26). Summaries of C.R.S. 6-1-716 and 24-34-802; the statute text itself was not re-quoted.
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-co-breach-notice-days-20260101', 'co.breach_notice_days', '30', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.dwt.com/gcp/states/colorado',
   'Summary of C.R.S. 6-1-716: notify affected Colorado residents within 30 days after determining a breach occurred.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-breach-ag-threshold-20260101', 'co.breach_ag_threshold', '500', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.dwt.com/gcp/states/colorado',
   'Summary of C.R.S. 6-1-716: also notify the Attorney General when 500 or more Colorado residents are affected.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-breach-bureau-threshold-20260101', 'co.breach_bureau_threshold', '1000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.dwt.com/gcp/states/colorado',
   'Summary of C.R.S. 6-1-716: also notify the consumer reporting agencies when more than 1,000 Colorado residents are affected.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-accessibility-fix-days-20260101', 'co.accessibility_fix_days', '30', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.dwt.com/gcp/states/colorado',
   'Summary of C.R.S. 24-34-802: a small business that fixes the problem within 30 days pays a reduced amount.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now());
