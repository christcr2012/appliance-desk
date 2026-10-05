-- Batch B2 lifecycle foundation. Additive only.
ALTER TYPE "ProviderOperationStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TYPE "InvoiceLineItemKind" ADD VALUE IF NOT EXISTS 'LATE_RETURN_WAIVER';

CREATE TYPE "SubscriptionEndMode" AS ENUM ('NO_END', 'END_AT', 'CLOSED');

CREATE TABLE "SubscriptionEndIntent" (
    "stripeSubscriptionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mode" "SubscriptionEndMode" NOT NULL,
    "cancelAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "holderAgreementId" TEXT NOT NULL,
    "appliedVersion" INTEGER NOT NULL DEFAULT 0,
    "appliedMode" "SubscriptionEndMode",
    "appliedCancelAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionEndIntent_pkey" PRIMARY KEY ("stripeSubscriptionId")
);

CREATE INDEX "SubscriptionEndIntent_nextAttemptAt_idx" ON "SubscriptionEndIntent"("nextAttemptAt");
CREATE INDEX "SubscriptionEndIntent_holderAgreementId_idx" ON "SubscriptionEndIntent"("holderAgreementId");

CREATE TABLE "LateReturnWaiver" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "waivedDays" INTEGER NOT NULL,
    "waivedCents" INTEGER NOT NULL,
    "waivedTaxCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LateReturnWaiver_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LateReturnWaiver_jobId_key" ON "LateReturnWaiver"("jobId");
CREATE INDEX "LateReturnWaiver_invoiceId_idx" ON "LateReturnWaiver"("invoiceId");

CREATE TABLE "MonthToMonthTermsVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "noticeDays" INTEGER NOT NULL,
    "termsText" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT,

    CONSTRAINT "MonthToMonthTermsVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonthToMonthTermsVersion_version_key" ON "MonthToMonthTermsVersion"("version");

CREATE TABLE "EarlyReturnResolution" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "pickupDate" TIMESTAMP(3) NOT NULL,
    "billing" TEXT NOT NULL,
    "unusedDays" TEXT NOT NULL,
    "unusedDaysCount" INTEGER NOT NULL,
    "unusedCents" INTEGER NOT NULL,
    "unusedTaxCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "feeReason" TEXT,
    "feeInvoiceId" TEXT,
    "creditId" TEXT,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "refundByHandCents" INTEGER NOT NULL DEFAULT 0,
    "appliedBy" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarlyReturnResolution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EarlyReturnResolution_agreementId_key" ON "EarlyReturnResolution"("agreementId");
CREATE INDEX "EarlyReturnResolution_jobId_idx" ON "EarlyReturnResolution"("jobId");

ALTER TABLE "RentalAgreement"
  ADD COLUMN "continuityRootId" TEXT,
  ADD COLUMN "continuousSince" TIMESTAMP(3),
  ADD COLUMN "monthToMonthTermsVersion" INTEGER;

CREATE INDEX "RentalAgreement_continuityRootId_idx" ON "RentalAgreement"("continuityRootId");

ALTER TABLE "CustomerNotice"
  ADD COLUMN "earliestAt" TIMESTAMP(3),
  ADD COLUMN "deadlineAt" TIMESTAMP(3),
  ADD COLUMN "sentToAddress" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceDate" TIMESTAMP(3),
  ADD COLUMN "deliveryChannel" TEXT,
  ADD COLUMN "deliveryEvidence" JSONB,
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "resolvedByUserId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolution" TEXT;

CREATE UNIQUE INDEX "CustomerNotice_providerMessageId_key" ON "CustomerNotice"("providerMessageId");
CREATE INDEX "CustomerNotice_status_nextAttemptAt_idx" ON "CustomerNotice"("status", "nextAttemptAt");

ALTER TABLE "BusinessSettings"
  ADD COLUMN "noticeCertifierRoles" TEXT NOT NULL DEFAULT 'OWNER',
  ADD COLUMN "mailNoticeTransitDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "monthToMonthChangeNoticeDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "termsChangeNoticeText" TEXT,
  ADD COLUMN "annualReminderText" TEXT,
  ADD COLUMN "earlyReturnBilling" TEXT NOT NULL DEFAULT 'KEEP_TO_AGREED_END',
  ADD COLUMN "earlyReturnUnusedDays" TEXT NOT NULL DEFAULT 'KEEP',
  ADD COLUMN "earlyReturnFee" TEXT NOT NULL DEFAULT 'AGREED_TERMS_FEE',
  ADD COLUMN "earlyReturnHandling" TEXT NOT NULL DEFAULT 'ASK_ME';

-- DATA STEP 2 START
INSERT INTO "MonthToMonthTermsVersion" ("id","version","noticeDays","termsText","publishedAt","publishedByUserId")
SELECT 'mtm-terms-v1', 1, "earlyTerminationNoticeDays", "terminationTermsText", NOW(), NULL
FROM "BusinessSettings"
WHERE "id" = 'singleton' AND "earlyTerminationNoticeDays" IS NOT NULL AND "terminationTermsText" IS NOT NULL
ON CONFLICT DO NOTHING;
-- DATA STEP 2 END

-- DATA STEP 3 START
WITH RECURSIVE chain AS (
  SELECT "id", "id" AS root, "firstDeliveredOn" AS since FROM "RentalAgreement" WHERE "renewedFromAgreementId" IS NULL
  UNION ALL
  SELECT a."id", c.root, c.since FROM "RentalAgreement" a JOIN chain c ON a."renewedFromAgreementId" = c."id"
)
UPDATE "RentalAgreement" r SET "continuityRootId" = chain.root, "continuousSince" = chain.since
FROM chain WHERE r."id" = chain."id" AND r."continuityRootId" IS NULL;
-- DATA STEP 3 END

-- DATA STEP 4 START
UPDATE "RentalAgreement"
SET "monthToMonthTermsVersion" = 1
WHERE "status" = 'ACTIVE'::"RentalAgreementStatus"
  AND "termMonths" IS NULL
  AND "monthToMonthTermsVersion" IS NULL
  AND EXISTS (SELECT 1 FROM "MonthToMonthTermsVersion" WHERE "version" = 1);
-- DATA STEP 4 END

-- DATA STEP 5 START
UPDATE "BusinessSettings"
SET "termsChangeNoticeText" = COALESCE(
      "termsChangeNoticeText",
      'Starting {{effectiveDate}}, these terms will apply to your month-to-month rental with {{businessName}}: {{terms}} You need at least {{noticeDays}} days'' notice to end a month-to-month rental. Fixed-term leases (6 or 12 months) are not affected by this change. You can end your rental at any time from the "My rentals" page of your customer account, or by contacting us at {{businessPhone}} or {{businessEmail}}.'
    ),
    "annualReminderText" = COALESCE(
      "annualReminderText",
      'Your month-to-month rental with {{businessName}} ({{items}}) continues automatically each month at {{monthlyTotal}} a month plus any sales tax. On {{boundaryDate}} it will have been rented continuously for {{years}} year(s). You don''t need to do anything to keep it. To end it, use the "My rentals" page of your customer account or contact us at {{businessPhone}} or {{businessEmail}}; your rental then ends on the first billing date at least {{noticeDays}} days later.'
    )
WHERE "id" = 'singleton';
-- DATA STEP 5 END
