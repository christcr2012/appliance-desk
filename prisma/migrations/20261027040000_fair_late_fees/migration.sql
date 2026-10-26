-- FEE-1: fair late fees. Additive only: a late fee becomes its own pending charge, the customer is warned first.

-- CreateEnum
CREATE TYPE "LateFeeClass" AS ENUM ('CONSUMER_LEASE', 'CONSUMER_SHORT', 'BUSINESS');
CREATE TYPE "PendingChargeKind" AS ENUM ('LATE_FEE');

-- AlterEnum (the new value is not used in this migration)
ALTER TYPE "ProviderOperationKind" ADD VALUE 'LATE_FEE_INVOICE_ITEM';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "activeMilitary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RentalAgreement" ADD COLUMN "lateFeeClass" "LateFeeClass";
ALTER TABLE "Invoice"
  ADD COLUMN "lateNoticeDeliveryId" TEXT,
  ADD COLUMN "lateNoticeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateFeeDate" TIMESTAMP(3),
  ADD COLUMN "lateFeeToldOn" TIMESTAMP(3),
  ADD COLUMN "lateFeeToldByUserId" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "lateFeeNoticeDaysBefore" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_lateFeeNoticeDaysBefore_range"
  CHECK ("lateFeeNoticeDaysBefore" >= 1 AND "lateFeeNoticeDaysBefore" <= 5);

-- CreateTable
CREATE TABLE "PendingCharge" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "kind" "PendingChargeKind" NOT NULL DEFAULT 'LATE_FEE',
    "amountCents" INTEGER NOT NULL,
    "forInvoiceId" TEXT NOT NULL,
    "noticeDeliveryId" TEXT,
    "addedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedToInvoiceId" TEXT,
    "providerOperationId" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "waivedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingCharge_forInvoiceId_kind_key" ON "PendingCharge"("forInvoiceId", "kind");
CREATE INDEX "PendingCharge_appliedToInvoiceId_idx" ON "PendingCharge"("appliedToInvoiceId");
CREATE INDEX "PendingCharge_customerId_appliedToInvoiceId_waivedAt_idx" ON "PendingCharge"("customerId", "appliedToInvoiceId", "waivedAt");

ALTER TABLE "PendingCharge" ADD CONSTRAINT "PendingCharge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingCharge" ADD CONSTRAINT "PendingCharge_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingCharge" ADD CONSTRAINT "PendingCharge_forInvoiceId_fkey" FOREIGN KEY ("forInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingCharge" ADD CONSTRAINT "PendingCharge_appliedToInvoiceId_fkey" FOREIGN KEY ("appliedToInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One rule for every rental (Chris, 2026-10-25): a late fee needs the bill to be more than 10 days late and is never more than $15.
-- This moves the owner's own setting (not any signed agreement or billed history) to the new starting values.
ALTER TABLE "BusinessSettings" ALTER COLUMN "lateFeeGraceDays" SET DEFAULT 10;
ALTER TABLE "RentalAgreement" ALTER COLUMN "lateFeeGraceDays" SET DEFAULT 10;
UPDATE "BusinessSettings" SET "lateFeeGraceDays" = 10 WHERE "lateFeeGraceDays" < 10;
UPDATE "BusinessSettings" SET "lateFeeFlatCents" = 1500 WHERE "lateFeeFlatCents" > 1500;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_lateFeeGraceDays_min10" CHECK ("lateFeeGraceDays" >= 10);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_lateFeeFlatCents_max1500" CHECK ("lateFeeFlatCents" <= 1500);
