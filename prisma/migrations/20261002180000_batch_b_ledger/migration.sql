-- Batch B — durable provider reconciliation and financial ledger
-- docs/designs/BATCH-B.md D1-D12

ALTER TYPE "ReferralStatus" ADD VALUE 'REWARDING' BEFORE 'REWARDED';

CREATE TYPE "ProviderOperationKind" AS ENUM (
  'CUSTOMER_CREATE',
  'SUBSCRIPTION_CREATE',
  'SUBSCRIPTION_CANCEL',
  'BALANCE_CREDIT',
  'REFUND_CREATE'
);

CREATE TYPE "ProviderOperationStatus" AS ENUM (
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
  'DRIFT'
);

CREATE TYPE "ReceiptSource" AS ENUM ('STRIPE', 'MANUAL');

ALTER TABLE "RentalAgreement"
  ADD COLUMN "renewalPreference" TEXT,
  ADD COLUMN "autoRenewConsentedAt" TIMESTAMP(3),
  ADD COLUMN "autoRenewTermsVersion" TEXT,
  ADD COLUMN "renewedFromAgreementId" TEXT,
  ADD COLUMN "terminationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "terminationEffectiveOn" TIMESTAMP(3),
  ADD COLUMN "terminationFeeCents" INTEGER,
  ADD COLUMN "terminationPolicyVersion" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Payment"
  ADD COLUMN "receiptId" TEXT;

ALTER TABLE "CustomerCredit"
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "side" TEXT,
  ADD COLUMN "appliedViaStripeAt" TIMESTAMP(3);

ALTER TABLE "BusinessSettings"
  ADD COLUMN "earlyTerminationFeeCents" INTEGER,
  ADD COLUMN "earlyTerminationFeePercent" INTEGER,
  ADD COLUMN "earlyTerminationFeeCapCents" INTEGER,
  ADD COLUMN "earlyTerminationNoticeDays" INTEGER,
  ADD COLUMN "unusedTermTreatment" TEXT,
  ADD COLUMN "autoRenewNoticeDays" INTEGER,
  ADD COLUMN "autoRenewTermsVersion" TEXT,
  ADD COLUMN "renewalTermsText" TEXT,
  ADD COLUMN "terminationTermsText" TEXT;

CREATE TABLE "ProviderOperation" (
  "id" TEXT NOT NULL,
  "kind" "ProviderOperationKind" NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "ProviderOperationStatus" NOT NULL DEFAULT 'PENDING',
  "providerObjectId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Receipt" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "source" "ReceiptSource" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "stripeChargeId" TEXT,
  "receivedOn" TIMESTAMP(3) NOT NULL,
  "recordedByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditApplication" (
  "id" TEXT NOT NULL,
  "creditId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "appliedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderOperation_idempotencyKey_key"
  ON "ProviderOperation"("idempotencyKey");
CREATE INDEX "ProviderOperation_subjectType_subjectId_idx"
  ON "ProviderOperation"("subjectType", "subjectId");
CREATE INDEX "ProviderOperation_status_requestedAt_idx"
  ON "ProviderOperation"("status", "requestedAt");

CREATE UNIQUE INDEX "Receipt_stripeChargeId_key" ON "Receipt"("stripeChargeId");
CREATE INDEX "Receipt_customerId_receivedOn_idx" ON "Receipt"("customerId", "receivedOn");

CREATE INDEX "CreditApplication_creditId_idx" ON "CreditApplication"("creditId");
CREATE INDEX "CreditApplication_invoiceId_idx" ON "CreditApplication"("invoiceId");
CREATE INDEX "Payment_receiptId_idx" ON "Payment"("receiptId");

-- Prisma's three-column unique keeps referral sides unique. PostgreSQL treats
-- NULL values as distinct, so the second partial index is required to make
-- side-less sources (overpayment/refund/manual) truly idempotent as well.
CREATE UNIQUE INDEX "CustomerCredit_sourceType_sourceId_side_key"
  ON "CustomerCredit"("sourceType", "sourceId", "side");
CREATE UNIQUE INDEX "CustomerCredit_side_less_source_key"
  ON "CustomerCredit"("sourceType", "sourceId")
  WHERE "side" IS NULL AND "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL;

CREATE UNIQUE INDEX "InvoiceLineItem_one_late_fee_per_invoice"
  ON "InvoiceLineItem" ("invoiceId") WHERE "kind" = 'LATE_FEE';

ALTER TABLE "Receipt"
  ADD CONSTRAINT "Receipt_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication"
  ADD CONSTRAINT "CreditApplication_creditId_fkey"
  FOREIGN KEY ("creditId") REFERENCES "CustomerCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication"
  ADD CONSTRAINT "CreditApplication_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
