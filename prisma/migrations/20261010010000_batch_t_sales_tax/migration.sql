-- Batch T: Colorado sales and use tax foundation. Additive only.
ALTER TYPE "ProviderOperationKind" ADD VALUE IF NOT EXISTS 'TAX_RATE_CREATE';
ALTER TYPE "ProviderOperationKind" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_TAX_UPDATE';

CREATE TYPE "TaxJurisdictionLevel" AS ENUM ('STATE', 'COUNTY', 'CITY', 'SPECIAL_DISTRICT');
CREATE TYPE "TaxAdministration" AS ENUM ('STATE_COLLECTED', 'SELF_COLLECTED');
CREATE TYPE "TaxReviewStatus" AS ENUM ('NEEDS_REVIEW', 'REVIEWED');
CREATE TYPE "TaxChargeCategory" AS ENUM ('RENTAL', 'LATE_RETURN', 'DELIVERY', 'INSTALLATION', 'REMOVAL', 'DAMAGE_WAIVER', 'EARLY_TERMINATION', 'LATE_PAYMENT_FEE', 'OTHER_CHARGE');
CREATE TYPE "Taxability" AS ENUM ('TAXABLE', 'EXEMPT', 'UNDECIDED');
CREATE TYPE "TaxRateSource" AS ENUM ('COLORADO_GIS', 'BULK_FILE', 'MANUAL');
CREATE TYPE "TaxAddressStatus" AS ENUM ('VERIFIED', 'NEEDS_REVIEW', 'FAILED');
CREATE TYPE "ShortTermLeaseElection" AS ENUM ('UNDECIDED', 'PAY_ON_ACQUISITION', 'COLLECT_ON_RENTALS');
CREATE TYPE "TaxReportingBasis" AS ENUM ('UNDECIDED', 'ACCRUAL', 'CASH');
CREATE TYPE "TaxFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');
CREATE TYPE "TaxFilingStatus" AS ENUM ('OPEN', 'FILED');
CREATE TYPE "TaxExemptionReason" AS ENUM ('RESALE', 'GOVERNMENT', 'CHARITABLE', 'OTHER');
CREATE TYPE "TaxLineSource" AS ENUM ('ENGINE', 'STRIPE');
CREATE TYPE "UseTaxStatus" AS ENUM ('DUE', 'NOT_DUE', 'FILED');

ALTER TABLE "BusinessSettings"
  ADD COLUMN "shortTermLeaseElection" "ShortTermLeaseElection" NOT NULL DEFAULT 'UNDECIDED',
  ADD COLUMN "shortTermLeaseElectionNote" TEXT,
  ADD COLUMN "retailDeliveryFeeDecision" TEXT NOT NULL DEFAULT 'UNDECIDED',
  ADD COLUMN "businessTaxAddress" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "TaxFilingAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNumber" TEXT,
    "frequency" "TaxFilingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "dueDayOfFollowingMonth" INTEGER NOT NULL DEFAULT 20,
    "basis" "TaxReportingBasis" NOT NULL DEFAULT 'UNDECIDED',
    "portalUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxFilingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxJurisdiction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "TaxJurisdictionLevel" NOT NULL,
    "administration" "TaxAdministration" NOT NULL,
    "filingAccountId" TEXT,
    "reviewStatus" "TaxReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxJurisdiction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxRateVersion" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "rateMilliPercent" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" "TaxRateSource" NOT NULL,
    "sourceNote" TEXT,
    "recordedByUserId" TEXT,
    "stripeTaxRateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRateVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxabilityRule" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "category" "TaxChargeCategory" NOT NULL,
    "taxability" "Taxability" NOT NULL DEFAULT 'UNDECIDED',
    "reason" TEXT,
    "cpaConfirmedOn" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxabilityRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AddressTaxLocation" (
    "id" TEXT NOT NULL,
    "serviceAddressId" TEXT,
    "forBusinessLocation" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxAddressStatus" NOT NULL,
    "source" "TaxRateSource" NOT NULL,
    "normalizedAddress" TEXT,
    "reviewNote" TEXT,
    "lookedUpAt" TIMESTAMP(3) NOT NULL,
    "confirmedByUserId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressTaxLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AddressTaxJurisdiction" (
    "addressTaxLocationId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,

    CONSTRAINT "AddressTaxJurisdiction_pkey" PRIMARY KEY ("addressTaxLocationId","jurisdictionId")
);

CREATE TABLE "InvoiceTaxLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceLineItemId" TEXT,
    "jurisdictionId" TEXT NOT NULL,
    "rateVersionId" TEXT NOT NULL,
    "category" "TaxChargeCategory" NOT NULL,
    "taxableCents" INTEGER NOT NULL,
    "exemptCents" INTEGER NOT NULL DEFAULT 0,
    "exemptReason" TEXT,
    "taxCents" INTEGER NOT NULL,
    "source" "TaxLineSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceTaxLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerTaxExemption" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" "TaxExemptionReason" NOT NULL,
    "certificateNumber" TEXT,
    "certificatePhotoId" TEXT,
    "jurisdictionIds" JSONB NOT NULL DEFAULT '[]',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTaxExemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxFilingPeriod" (
    "id" TEXT NOT NULL,
    "filingAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "status" "TaxFilingStatus" NOT NULL DEFAULT 'OPEN',
    "worksheet" JSONB,
    "filedOn" TIMESTAMP(3),
    "confirmationNumber" TEXT,
    "amountPaidCents" INTEGER,
    "serviceFeeRetainedCents" INTEGER,
    "filedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxFilingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseUseTax" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "purchasedOn" TIMESTAMP(3) NOT NULL,
    "purchaseAmountCents" INTEGER NOT NULL,
    "vendorTaxCents" INTEGER NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "rateVersionId" TEXT NOT NULL,
    "useTaxDueCents" INTEGER NOT NULL,
    "status" "UseTaxStatus" NOT NULL,
    "filingPeriodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseUseTax_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxJurisdiction_code_key" ON "TaxJurisdiction"("code");
CREATE UNIQUE INDEX "TaxRateVersion_stripeTaxRateId_key" ON "TaxRateVersion"("stripeTaxRateId");
CREATE UNIQUE INDEX "TaxRateVersion_jurisdictionId_effectiveFrom_key" ON "TaxRateVersion"("jurisdictionId", "effectiveFrom");
CREATE UNIQUE INDEX "TaxabilityRule_jurisdictionId_category_key" ON "TaxabilityRule"("jurisdictionId", "category");
CREATE INDEX "AddressTaxLocation_serviceAddressId_isCurrent_idx" ON "AddressTaxLocation"("serviceAddressId", "isCurrent");
CREATE INDEX "InvoiceTaxLine_invoiceId_idx" ON "InvoiceTaxLine"("invoiceId");
CREATE INDEX "InvoiceTaxLine_jurisdictionId_createdAt_idx" ON "InvoiceTaxLine"("jurisdictionId", "createdAt");
CREATE INDEX "CustomerTaxExemption_customerId_idx" ON "CustomerTaxExemption"("customerId");
CREATE UNIQUE INDEX "TaxFilingPeriod_filingAccountId_periodStart_key" ON "TaxFilingPeriod"("filingAccountId", "periodStart");
CREATE UNIQUE INDEX "PurchaseUseTax_sourceType_sourceId_jurisdictionId_key" ON "PurchaseUseTax"("sourceType", "sourceId", "jurisdictionId");

-- Prisma cannot express these conditional uniqueness rules.
CREATE UNIQUE INDEX "TaxabilityRule_default_category_key" ON "TaxabilityRule"("category") WHERE "jurisdictionId" IS NULL;
CREATE UNIQUE INDEX "AddressTaxLocation_one_current_key" ON "AddressTaxLocation"("serviceAddressId") WHERE "isCurrent" AND "serviceAddressId" IS NOT NULL;
CREATE UNIQUE INDEX "AddressTaxLocation_one_business_key" ON "AddressTaxLocation"("forBusinessLocation") WHERE "isCurrent" AND "forBusinessLocation";

ALTER TABLE "TaxJurisdiction"
  ADD CONSTRAINT "TaxJurisdiction_filingAccountId_fkey"
  FOREIGN KEY ("filingAccountId") REFERENCES "TaxFilingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxRateVersion"
  ADD CONSTRAINT "TaxRateVersion_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaxabilityRule"
  ADD CONSTRAINT "TaxabilityRule_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AddressTaxLocation"
  ADD CONSTRAINT "AddressTaxLocation_serviceAddressId_fkey"
  FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AddressTaxJurisdiction"
  ADD CONSTRAINT "AddressTaxJurisdiction_addressTaxLocationId_fkey"
  FOREIGN KEY ("addressTaxLocationId") REFERENCES "AddressTaxLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AddressTaxJurisdiction"
  ADD CONSTRAINT "AddressTaxJurisdiction_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceTaxLine"
  ADD CONSTRAINT "InvoiceTaxLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceTaxLine"
  ADD CONSTRAINT "InvoiceTaxLine_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceTaxLine"
  ADD CONSTRAINT "InvoiceTaxLine_rateVersionId_fkey"
  FOREIGN KEY ("rateVersionId") REFERENCES "TaxRateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerTaxExemption"
  ADD CONSTRAINT "CustomerTaxExemption_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaxFilingPeriod"
  ADD CONSTRAINT "TaxFilingPeriod_filingAccountId_fkey"
  FOREIGN KEY ("filingAccountId") REFERENCES "TaxFilingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseUseTax"
  ADD CONSTRAINT "PurchaseUseTax_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseUseTax"
  ADD CONSTRAINT "PurchaseUseTax_rateVersionId_fkey"
  FOREIGN KEY ("rateVersionId") REFERENCES "TaxRateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseUseTax"
  ADD CONSTRAINT "PurchaseUseTax_filingPeriodId_fkey"
  FOREIGN KEY ("filingPeriodId") REFERENCES "TaxFilingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data seed: legal/policy scaffolding only. No rate or taxability answer is guessed.
INSERT INTO "TaxJurisdiction"
  ("id", "code", "name", "level", "administration", "reviewStatus", "reviewedAt", "createdAt", "updatedAt")
VALUES
  ('tax-jurisdiction-co', 'CO', 'State of Colorado', 'STATE', 'STATE_COLLECTED', 'REVIEWED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "updatedAt")
VALUES
  ('tax-default-rental', NULL, 'RENTAL', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-late-return', NULL, 'LATE_RETURN', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-delivery', NULL, 'DELIVERY', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-installation', NULL, 'INSTALLATION', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-removal', NULL, 'REMOVAL', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-damage-waiver', NULL, 'DAMAGE_WAIVER', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-early-termination', NULL, 'EARLY_TERMINATION', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-late-payment-fee', NULL, 'LATE_PAYMENT_FEE', 'UNDECIDED', CURRENT_TIMESTAMP),
  ('tax-default-other-charge', NULL, 'OTHER_CHARGE', 'UNDECIDED', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
