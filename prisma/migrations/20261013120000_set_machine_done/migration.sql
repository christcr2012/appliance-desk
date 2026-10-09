-- W-21B (D-WB8 case 1): a set machine the customer is done with amends the line to single prices. The amendment's source is
-- now either the never-delivered item (existing rows) or the out-of-service period. Additive: relaxing NOT NULL only.

-- AlterTable
ALTER TABLE "RentalLineAmendment" ADD COLUMN     "outOfServicePeriodId" TEXT,
ALTER COLUMN "pendingDeliveryId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RentalLineAmendment_outOfServicePeriodId_key" ON "RentalLineAmendment"("outOfServicePeriodId");


ALTER TABLE "RentalLineAmendment" ADD CONSTRAINT "RentalLineAmendment_one_source"
  CHECK (("pendingDeliveryId" IS NULL) <> ("outOfServicePeriodId" IS NULL));
