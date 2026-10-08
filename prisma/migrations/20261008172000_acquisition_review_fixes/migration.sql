ALTER TABLE "Appliance" ADD COLUMN "acquisitionTaxChoice" TEXT;
CREATE UNIQUE INDEX "Appliance_acquisitionReceiptPhotoId_key" ON "Appliance"("acquisitionReceiptPhotoId");
ALTER TABLE "Appliance" ADD CONSTRAINT "Appliance_acquisitionReceiptPhotoId_fkey" FOREIGN KEY ("acquisitionReceiptPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
