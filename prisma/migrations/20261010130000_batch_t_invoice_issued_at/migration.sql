-- Additive evidence for correct Colorado accrual filing. Existing Stripe invoices
-- are NOT assigned guessed issue dates: they require verified provider sync.
ALTER TABLE "Invoice" ADD COLUMN "issuedAt" TIMESTAMP(3);
UPDATE "Invoice" SET "issuedAt" = "createdAt"
WHERE "stripeInvoiceId" IS NULL AND "status" NOT IN ('DRAFT'::"InvoiceStatus", 'VOID'::"InvoiceStatus");
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");
