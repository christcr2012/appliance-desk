-- FEETAX-1: optional, separately stated service lines. One choice record per
-- service on an order (the proof the tax engine needs), the HAUL_AWAY charge
-- category and bill line kind, the optional-and-separate answer on taxability
-- rules and their dated versions, and the service-fee settings. All additive:
-- existing rows keep their meaning; a null optionalSeparatedTreatment means
-- "same as the regular answer".

-- CreateEnum
CREATE TYPE "ServiceChoice" AS ENUM ('BY_BUSINESS', 'CUSTOMER_DOES_IT', 'NOT_NEEDED');

-- AlterEnum
ALTER TYPE "InvoiceLineItemKind" ADD VALUE 'HAUL_AWAY_FEE';

-- AlterEnum
ALTER TYPE "TaxChargeCategory" ADD VALUE 'HAUL_AWAY';

-- AlterTable
ALTER TABLE "TaxabilityRule" ADD COLUMN     "optionalSeparatedTreatment" "Taxability";

-- AlterTable
ALTER TABLE "TaxabilityRuleVersion" ADD COLUMN     "optionalSeparatedTreatment" "Taxability";

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "laborCostPerMinuteCents" INTEGER,
ADD COLUMN     "selfInstallAllowedCategories" JSONB NOT NULL DEFAULT '["WASHER","DRYER_ELECTRIC","FRIDGE","FREEZER"]',
ADD COLUMN     "serviceFeeCostLimitPercent" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "truckCostPerMileCents" INTEGER;

-- CreateTable
CREATE TABLE "OrderServiceChoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "agreementId" TEXT,
    "service" "TaxChargeCategory" NOT NULL,
    "choice" "ServiceChoice" NOT NULL,
    "offeredPriceCents" INTEGER NOT NULL,
    "alternativeShown" BOOLEAN NOT NULL,
    "quoteVersion" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderServiceChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceChoice_orderId_service_key" ON "OrderServiceChoice"("orderId", "service");
