-- Additive only: previously owned appliances have UNKNOWN acquisition evidence.
CREATE TYPE "AcquisitionTaxStatus" AS ENUM ('UNKNOWN', 'SALES_TAX_PAID', 'USE_TAX_DUE', 'USE_TAX_PAID', 'BOUGHT_TAX_FREE_FOR_LEASE');
ALTER TABLE "Appliance"
  ADD COLUMN "acquisitionTaxStatus" "AcquisitionTaxStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "acquisitionTaxPaidCents" INTEGER,
  ADD COLUMN "acquisitionSellerNote" TEXT,
  ADD COLUMN "acquisitionReceiptPhotoId" TEXT,
  ADD COLUMN "acquisitionTaxRecordedAt" TIMESTAMP(3),
  ADD COLUMN "acquisitionTaxRecordedByUserId" TEXT;
