-- Additive (Batch M, shop sales). New enum values and nullable / defaulted columns only; nothing changes until a sale is rung up.
ALTER TYPE "InvoiceLineItemKind" ADD VALUE IF NOT EXISTS 'MERCHANDISE';
ALTER TYPE "InvoiceLineItemKind" ADD VALUE IF NOT EXISTS 'USED_APPLIANCE';
ALTER TYPE "TaxChargeCategory" ADD VALUE IF NOT EXISTS 'MERCHANDISE';
ALTER TYPE "TaxChargeCategory" ADD VALUE IF NOT EXISTS 'USED_APPLIANCE_SALE';

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "isWalkIn" BOOLEAN NOT NULL DEFAULT false;
-- At most one built-in walk-in customer.
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_one_walk_in" ON "Customer" ("isWalkIn") WHERE "isWalkIn";

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "saleKind" TEXT,
  ADD COLUMN IF NOT EXISTS "saleLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "saleServiceAddressId" TEXT,
  ADD COLUMN IF NOT EXISTS "walkInName" TEXT,
  ADD COLUMN IF NOT EXISTS "saleOperationKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_saleOperationKey_key" ON "Invoice" ("saleOperationKey");
CREATE INDEX IF NOT EXISTS "Invoice_saleKind_idx" ON "Invoice" ("saleKind") WHERE "saleKind" IS NOT NULL;

ALTER TABLE "InvoiceLineItem" ADD COLUMN IF NOT EXISTS "partRecordId" TEXT;
ALTER TABLE "PartStockMovement" ADD COLUMN IF NOT EXISTS "invoiceLineId" TEXT;
CREATE INDEX IF NOT EXISTS "PartStockMovement_invoiceLineId_idx" ON "PartStockMovement" ("invoiceLineId") WHERE "invoiceLineId" IS NOT NULL;

-- Income accounts for items and used appliances sold (existing databases; the chart in code lists them too).
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","createdAt","updatedAt")
VALUES
 ('shopsales_items','MERCHANDISE_INCOME','Item sales','INCOME','Parts and other items sold to customers',FALSE,TRUE,93,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('shopsales_retired','RETIRED_APPLIANCE_SALES','Sales of retired appliances','INCOME','Used appliances sold after they left the rental fleet',FALSE,TRUE,94,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("systemRole") DO NOTHING;

-- No tax rules are created here: the two new categories have no answer until the owner records one (IN-46, IN-79),
-- and a sale is refused with a plain message until then.
