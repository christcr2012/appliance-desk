ALTER TABLE "LocationContact" ADD COLUMN "privacyHoldAt" TIMESTAMP(3),
  ADD COLUMN "privacyHoldReason" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "tenantContactPurgeApprovedAt" TIMESTAMP(3),
  ADD COLUMN "tenantContactPurgeApprovalReference" TEXT,
  ADD COLUMN "tenantContactPurgeApprovedBy" TEXT;
CREATE TABLE "LocationPortfolioImport" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationPortfolioImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LocationPortfolioImport_customerId_digest_key"
  ON "LocationPortfolioImport"("customerId","digest");
