-- Additive (BILL-1: bank payments being confirmed). One new table that only flags "the bank is confirming a payment",
-- one owner setting with its starting value (6 banking days before To do asks Chris to look). Nothing existing is
-- removed or rewritten; no bill, payment, receipt or total changes.

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "bankPaymentSlowBusinessDays" INTEGER NOT NULL DEFAULT 6;

-- CreateTable
CREATE TABLE "BankPaymentInFlight" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "stripeInvoiceId" TEXT,
    "agreementId" TEXT,
    "source" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "clearedReason" TEXT,
    "clearedByEventAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "lastCheckedAt" TIMESTAMP(3),
    "settledInStripeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankPaymentInFlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankPaymentInFlight_paymentIntentId_key" ON "BankPaymentInFlight"("paymentIntentId");

-- CreateIndex
CREATE INDEX "BankPaymentInFlight_invoiceId_clearedAt_idx" ON "BankPaymentInFlight"("invoiceId", "clearedAt");

-- CreateIndex
CREATE INDEX "BankPaymentInFlight_clearedAt_startedAt_idx" ON "BankPaymentInFlight"("clearedAt", "startedAt");

-- CreateIndex
CREATE INDEX "BankPaymentInFlight_clearedAt_lastCheckedAt_idx" ON "BankPaymentInFlight"("clearedAt", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "BankPaymentInFlight_stripeInvoiceId_idx" ON "BankPaymentInFlight"("stripeInvoiceId");

-- AddForeignKey
ALTER TABLE "BankPaymentInFlight" ADD CONSTRAINT "BankPaymentInFlight_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankPaymentInFlight" ADD CONSTRAINT "BankPaymentInFlight_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A row always names a bill or a rental agreement, and the slow-payment setting keeps the owner range the save function enforces.
ALTER TABLE "BankPaymentInFlight" ADD CONSTRAINT "BankPaymentInFlight_has_target"
  CHECK ("invoiceId" IS NOT NULL OR "agreementId" IS NOT NULL);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_bankPaymentSlowBusinessDays_range"
  CHECK ("bankPaymentSlowBusinessDays" >= 2 AND "bankPaymentSlowBusinessDays" <= 20);
