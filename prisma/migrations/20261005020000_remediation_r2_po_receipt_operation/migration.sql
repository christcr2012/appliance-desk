-- R16: durable identity for purchase-order receipt requests. Additive only: one new table,
-- no existing row is read, changed or deleted.
CREATE TABLE "PurchaseOrderReceiptOperation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderReceiptOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderReceiptOperation_operationKey_key" ON "PurchaseOrderReceiptOperation"("operationKey");

CREATE INDEX "PurchaseOrderReceiptOperation_purchaseOrderId_idx" ON "PurchaseOrderReceiptOperation"("purchaseOrderId");

ALTER TABLE "PurchaseOrderReceiptOperation" ADD CONSTRAINT "PurchaseOrderReceiptOperation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
