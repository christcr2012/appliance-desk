-- Phase 6B: billing data model redesign (see docs/DECISIONS.md's
-- "Phase 6B billing data model redesign" entry for the full writeup).
-- Nothing in the app reads or writes Invoice/Payment/Deposit yet, so
-- every change below is purely additive -- no existing row anywhere is
-- affected, and no backfill is needed.

ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_PAID';
ALTER TYPE "InvoiceStatus" ADD VALUE 'WRITTEN_OFF';
ALTER TYPE "InvoiceStatus" ADD VALUE 'REFUNDED';

CREATE TYPE "InvoiceLineItemKind" AS ENUM ('RENTAL', 'DELIVERY_FEE', 'INSTALLATION_FEE', 'REMOVAL_FEE', 'DAMAGE_WAIVER', 'DEPOSIT', 'TAX', 'LATE_FEE', 'PREPAY_DISCOUNT', 'CREDIT', 'ADJUSTMENT');

CREATE TYPE "RefundReason" AS ENUM ('OVERPAYMENT', 'BILLING_ERROR', 'GOODWILL', 'DISPUTE_RESOLUTION', 'OTHER');

-- One Stripe Customer per Appliance Desk customer.
ALTER TABLE "Customer" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");

-- One Stripe Subscription per active agreement, plus the date that
-- drives anniversary billing (docs/BUSINESS-RULES.md's billing rules).
ALTER TABLE "RentalAgreement" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "RentalAgreement" ADD COLUMN "nextBillingDate" TIMESTAMP(3);
CREATE UNIQUE INDEX "RentalAgreement_stripeSubscriptionId_key" ON "RentalAgreement"("stripeSubscriptionId");

-- Who authorized a deposit refund, and why it was less than the full amount.
ALTER TABLE "Deposit" ADD COLUMN "deductionReason" TEXT;
ALTER TABLE "Deposit" ADD COLUMN "refundedByUserId" TEXT;
ALTER TABLE "Deposit" ADD COLUMN "stripeRefundId" TEXT;

-- Sequential, human-facing invoice numbers.
CREATE SEQUENCE "Invoice_invoiceNumber_seq";
ALTER TABLE "Invoice" ADD COLUMN "invoiceNumber" INTEGER NOT NULL DEFAULT nextval('"Invoice_invoiceNumber_seq"');
ALTER SEQUENCE "Invoice_invoiceNumber_seq" OWNED BY "Invoice"."invoiceNumber";
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- Billing-period dates (billing is always in advance) and a real
-- subtotal/discount/tax/late-fee breakdown, plus cancellation/write-off
-- tracking.
ALTER TABLE "Invoice" ADD COLUMN "billingPeriodStart" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "billingPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "subtotalCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "taxCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "lateFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "writtenOffAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "writtenOffReason" TEXT;

-- Immutable snapshot lines making up each invoice.
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "kind" "InvoiceLineItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "rentalLineId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE
);

-- Attempt tracking and ACH-vs-card charge id on each payment attempt.
ALTER TABLE "Payment" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Payment" ADD COLUMN "stripeChargeId" TEXT;

-- A refund of money already paid on an invoice (a security-deposit
-- refund stays on Deposit itself -- see the columns added to it above).
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "notes" TEXT,
    "authorizedByUserId" TEXT,
    "stripeRefundId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
);

-- An account-level credit applied to a future invoice.
CREATE TABLE "CustomerCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "remainingCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "authorizedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "CustomerCredit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
);

-- Every Stripe webhook event this app has processed, keyed by Stripe's
-- own event id, so a duplicate delivery is never acted on twice.
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
