-- Batch T-6C1: additive Colorado retail-delivery-fee capability.
-- Historical invoices, leases, and tax returns are intentionally unchanged.
CREATE TYPE "RdfHandling" AS ENUM ('UNDECIDED', 'COLLECT_FROM_CUSTOMER', 'PAY_MYSELF');
CREATE TYPE "RdfRecordStatus" AS ENUM ('PENDING_DECISION', 'PENDING_RATE', 'READY', 'NOT_DUE');

ALTER TYPE "TaxFilingAccountKind" ADD VALUE 'RETAIL_DELIVERY_FEE_RETURN';
ALTER TYPE "InvoiceLineItemKind" ADD VALUE 'RETAIL_DELIVERY_FEE';
ALTER TYPE "ProviderOperationKind" ADD VALUE 'RDF_INVOICE_ITEM';

ALTER TABLE "BusinessSettings"
  ADD COLUMN "rdfThresholdCents" INTEGER NOT NULL DEFAULT 50000000,
  ADD COLUMN "rdfHandling" "RdfHandling" NOT NULL DEFAULT 'UNDECIDED',
  ADD COLUMN "rdfCpaConfirmedOn" TIMESTAMP(3),
  ADD COLUMN "rdfThresholdCrossedOn" TIMESTAMP(3);

ALTER TABLE "BusinessSettings"
  ADD CONSTRAINT "BusinessSettings_rdfThreshold_nonnegative" CHECK ("rdfThresholdCents" >= 0);

CREATE TABLE "RetailDeliveryFeeRate" (
  "id" TEXT NOT NULL,
  "effectiveOn" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "enteredByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetailDeliveryFeeRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetailDeliveryFeeRate_amount_nonnegative" CHECK ("amountCents" >= 0),
  CONSTRAINT "RetailDeliveryFeeRate_enteredByUserId_fkey"
    FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RetailDeliveryFeeRate_effectiveOn_key" ON "RetailDeliveryFeeRate"("effectiveOn");

CREATE TABLE "RetailDeliveryFeeRecord" (
  "id" TEXT NOT NULL,
  "saleKey" TEXT NOT NULL,
  "firstJobId" TEXT,
  "agreementId" TEXT,
  "invoiceId" TEXT,
  "deliveredOn" TIMESTAMP(3) NOT NULL,
  "saleOn" TIMESTAMP(3),
  "customerRefundedAt" TIMESTAMP(3),
  "customerRefundRef" TEXT,
  "creditAppliedPeriodId" TEXT,
  "status" "RdfRecordStatus" NOT NULL,
  "rateId" TEXT,
  "amountCents" INTEGER,
  "collectedFromCustomer" BOOLEAN,
  "invoiceLineId" TEXT,
  "filingPeriodId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetailDeliveryFeeRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetailDeliveryFeeRecord_parent_check" CHECK (
    ("agreementId" IS NOT NULL AND "firstJobId" IS NOT NULL AND "invoiceId" IS NULL)
    OR ("agreementId" IS NULL AND "firstJobId" IS NULL AND "invoiceId" IS NOT NULL)
  ),
  CONSTRAINT "RetailDeliveryFeeRecord_nonnegative_amount" CHECK ("amountCents" IS NULL OR "amountCents" >= 0),
  CONSTRAINT "RetailDeliveryFeeRecord_ready_requires_evidence" CHECK (
    "status" <> 'READY' OR
    ("saleOn" IS NOT NULL AND "rateId" IS NOT NULL AND "amountCents" IS NOT NULL)
  ),
  CONSTRAINT "RetailDeliveryFeeRecord_firstJobId_fkey"
    FOREIGN KEY ("firstJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RetailDeliveryFeeRecord_agreementId_fkey"
    FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RetailDeliveryFeeRecord_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RetailDeliveryFeeRecord_creditAppliedPeriodId_fkey"
    FOREIGN KEY ("creditAppliedPeriodId") REFERENCES "TaxFilingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RetailDeliveryFeeRecord_rateId_fkey"
    FOREIGN KEY ("rateId") REFERENCES "RetailDeliveryFeeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RetailDeliveryFeeRecord_invoiceLineId_fkey"
    FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RetailDeliveryFeeRecord_filingPeriodId_fkey"
    FOREIGN KEY ("filingPeriodId") REFERENCES "TaxFilingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RetailDeliveryFeeRecord_saleKey_key" ON "RetailDeliveryFeeRecord"("saleKey");
CREATE UNIQUE INDEX "RetailDeliveryFeeRecord_invoiceLineId_key" ON "RetailDeliveryFeeRecord"("invoiceLineId");
CREATE INDEX "RetailDeliveryFeeRecord_agreementId_idx" ON "RetailDeliveryFeeRecord"("agreementId");
CREATE INDEX "RetailDeliveryFeeRecord_firstJobId_idx" ON "RetailDeliveryFeeRecord"("firstJobId");
CREATE INDEX "RetailDeliveryFeeRecord_invoiceId_idx" ON "RetailDeliveryFeeRecord"("invoiceId");
CREATE INDEX "RetailDeliveryFeeRecord_status_deliveredOn_idx" ON "RetailDeliveryFeeRecord"("status", "deliveredOn");
CREATE INDEX "RetailDeliveryFeeRecord_filingPeriodId_idx" ON "RetailDeliveryFeeRecord"("filingPeriodId");
