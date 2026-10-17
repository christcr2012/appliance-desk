-- W-14/W-2/W-15 purchase records. Additive only: old appliances keep every existing field and simply have no purchase.

-- CreateEnum
CREATE TYPE "PurchaseSellerTaxKind" AS ENUM ('COLORADO', 'OTHER_STATE', 'NONE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PurchaseDocumentKind" AS ENUM ('RECEIPT', 'INVOICE', 'OTHER');

-- AlterTable
ALTER TABLE "Appliance" ADD COLUMN "purchaseId" TEXT;

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN "recordRetentionYears" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_recordRetentionYears_check"
  CHECK ("recordRetentionYears" BETWEEN 1 AND 50);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "supplierId" TEXT,
    "sellerName" TEXT,
    "purchasedOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "sellerTaxCents" INTEGER NOT NULL DEFAULT 0,
    "sellerTaxKind" "PurchaseSellerTaxKind" NOT NULL,
    "sellerTaxState" TEXT,
    "otherChargesCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "taxRevisionAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Purchase_money_check" CHECK ("subtotalCents" >= 0 AND "sellerTaxCents" >= 0 AND "otherChargesCents" >= 0),
    CONSTRAINT "Purchase_seller_check" CHECK ("supplierId" IS NOT NULL OR "sellerName" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "kind" "PurchaseDocumentKind" NOT NULL DEFAULT 'RECEIPT',
    "pageOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderReceiptTax" (
    "id" TEXT NOT NULL,
    "receiptOperationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sellerTaxKind" "PurchaseSellerTaxKind" NOT NULL,
    "sellerTaxCents" INTEGER NOT NULL DEFAULT 0,
    "sellerTaxState" TEXT,
    "receivedAmountCents" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "revisionAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderReceiptTax_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseOrderReceiptTax_answer_check" CHECK ("answer" IN ('SELLER_CHARGED', 'NONE_CHARGED', 'LATER')),
    CONSTRAINT "PurchaseOrderReceiptTax_money_check" CHECK ("sellerTaxCents" >= 0 AND "receivedAmountCents" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_operationKey_key" ON "Purchase"("operationKey");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_idx" ON "Purchase"("supplierId");

-- CreateIndex
CREATE INDEX "Purchase_purchasedOn_idx" ON "Purchase"("purchasedOn");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_photoId_key" ON "PurchaseDocument"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_purchaseId_pageOrder_key" ON "PurchaseDocument"("purchaseId", "pageOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderReceiptTax_receiptOperationId_key" ON "PurchaseOrderReceiptTax"("receiptOperationId");

-- CreateIndex
CREATE INDEX "PurchaseOrderReceiptTax_purchaseOrderId_idx" ON "PurchaseOrderReceiptTax"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Appliance_purchaseId_idx" ON "Appliance"("purchaseId");

-- AddForeignKey
ALTER TABLE "Appliance" ADD CONSTRAINT "Appliance_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderReceiptTax" ADD CONSTRAINT "PurchaseOrderReceiptTax_receiptOperationId_fkey" FOREIGN KEY ("receiptOperationId") REFERENCES "PurchaseOrderReceiptOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
