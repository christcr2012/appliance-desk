-- M-2C: frozen income-tax estimate for each retired appliance sold. Additive only.
CREATE TABLE "RetiredSaleDisposition" (
    "id" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "sellerCostsCents" INTEGER NOT NULL DEFAULT 0,
    "bookCarriedCents" INTEGER NOT NULL,
    "taxStatus" TEXT NOT NULL,
    "evidenceId" TEXT,
    "evidenceClassification" TEXT,
    "evidenceConfidence" TEXT,
    "adjustedBasisCents" INTEGER,
    "totalDepreciationCents" INTEGER,
    "taxGainCents" INTEGER,
    "potentialRecaptureCents" INTEGER,
    "otherGainCents" INTEGER,
    "reviewReasons" TEXT[],
    "followUpDoneAt" TIMESTAMP(3),
    "followUpDoneByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetiredSaleDisposition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetiredSaleDisposition_invoiceId_applianceId_key" ON "RetiredSaleDisposition"("invoiceId", "applianceId");
CREATE INDEX "RetiredSaleDisposition_applianceId_idx" ON "RetiredSaleDisposition"("applianceId");
CREATE INDEX "RetiredSaleDisposition_followUpDoneAt_cancelledAt_idx" ON "RetiredSaleDisposition"("followUpDoneAt", "cancelledAt");
ALTER TABLE "RetiredSaleDisposition" ADD CONSTRAINT "RetiredSaleDisposition_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetiredSaleDisposition" ADD CONSTRAINT "RetiredSaleDisposition_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
