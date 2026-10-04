-- Pickup and return billing rules (owner decisions IN-24 / IN-26 / IN-27, 2026-10-03).
-- Additive only: three settings with their recommended starting values, and one
-- new invoice line kind for rent charged for days kept past the end date.
ALTER TABLE "BusinessSettings" ADD COLUMN "lateReturnRateMode" TEXT NOT NULL DEFAULT 'MONTHLY_DIV_30';
ALTER TABLE "BusinessSettings" ADD COLUMN "lateReturnFixedDailyCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD COLUMN "earlyReturnProrationBasis" TEXT NOT NULL DEFAULT 'MONTHLY_DIV_30';
ALTER TABLE "BusinessSettings" ADD COLUMN "pickupDayNotBilled" BOOLEAN NOT NULL DEFAULT true;

ALTER TYPE "InvoiceLineItemKind" ADD VALUE 'LATE_RETURN';

-- Which mirrored Stripe invoice a Stripe-applied account credit was shown on.
ALTER TABLE "CustomerCredit" ADD COLUMN "shownOnInvoiceId" TEXT;
