-- OPS-6: collecting from customers who stop paying. Additive only: new enums, columns and tables, plus three
-- researched small-claims rule versions (Colorado Judicial Branch, accessed 2026-10-26).

CREATE TYPE "CollectionStepKind" AS ENUM ('SECOND_NOTICE', 'FINAL_NOTICE', 'DECISION', 'SMALL_CLAIMS');
CREATE TYPE "CollectionStepState" AS ENUM ('WAITING', 'SENT', 'SKIPPED', 'DONE');

ALTER TABLE "BusinessSettings" ADD COLUMN "collectionSecondNoticeDay" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "BusinessSettings" ADD COLUMN "collectionFinalNoticeDay" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "BusinessSettings" ADD COLUMN "collectionDecisionDay" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "CollectionStep" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "CollectionStepKind" NOT NULL,
    "state" "CollectionStepState" NOT NULL DEFAULT 'WAITING',
    "cameUpOn" TIMESTAMP(3) NOT NULL,
    "amountOwedCents" INTEGER NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "deliveryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionCase" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickupConsentAt" TIMESTAMP(3),
    "pickupConsentHow" TEXT,
    "pickupConsentByUserId" TEXT,
    "courtOrderOn" TIMESTAMP(3),
    "courtOrderNote" TEXT,
    "pickupJobId" TEXT,
    "objectedAt" TIMESTAMP(3),
    "objectedNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmallClaimsFiling" (
    "id" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "filedOn" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "agreementId" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmallClaimsFiling_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectionStep_invoiceId_kind_key" ON "CollectionStep"("invoiceId", "kind");
CREATE INDEX "CollectionStep_state_kind_idx" ON "CollectionStep"("state", "kind");
CREATE INDEX "CollectionStep_customerId_idx" ON "CollectionStep"("customerId");
CREATE UNIQUE INDEX "CollectionCase_agreementId_key" ON "CollectionCase"("agreementId");
CREATE INDEX "CollectionCase_resolvedAt_idx" ON "CollectionCase"("resolvedAt");
CREATE INDEX "SmallClaimsFiling_county_filedOn_idx" ON "SmallClaimsFiling"("county", "filedOn");

ALTER TABLE "CollectionStep" ADD CONSTRAINT "CollectionStep_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectionStep" ADD CONSTRAINT "CollectionStep_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: small-claims rules (accessed 2026-10-26): limit $7,500 (C.R.S. 13-6-403); 2 a month and 18 a year per county;
-- county-court filing fee $31 for claims up to $500 and $55 for $501 to $7,500.
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-co-small-claims-limit-20260101', 'co.small_claims_limit', '750000', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.coloradojudicial.gov/sites/default/files/2026-10/SmallClaimsInfoFor%20Website2026.pdf',
   'Small Claims cases are used for cases up to $7,500 in value.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-small-claims-filing-limits-20260101', 'co.small_claims_filing_limits', '{"perMonth":2,"perYear":18}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.coloradojudicial.gov/sites/default/files/2026-10/SmallClaimsInfoFor%20Website2026.pdf',
   'You are limited to 2 Small Claims a month, and no more than 18 a year per county.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-co-small-claims-fees-20260101', 'co.small_claims_fees', '{"lowMaxCents":50000,"lowFeeCents":3100,"highFeeCents":5500}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://coloradojudicial.gov/es/topic/193',
   'Claims of $1.00 to $500.00: $31. Claims of $501.00 to $7,500.00: $55.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now());
