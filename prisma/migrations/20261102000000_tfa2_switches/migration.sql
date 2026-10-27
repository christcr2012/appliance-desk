-- TFA-2: prepared delivery-fee switches (TAX-FEE-AUTOPILOT section 6.3) and
-- replacement-sale evidence (section 6.6).
-- The app prepares and dates each switch (the new-business start, the January 1
-- stop after a year at or under the small-seller limit, the January 1 start
-- after a year over it); a switch changes a customer bill only after the owner
-- approves it on Today. Until then the fee is owed but not billed.
-- Additive only: one new table, one new enum, one nullable column.

-- CreateEnum
CREATE TYPE "RdfSwitchKind" AS ENUM ('START', 'STOP');

-- CreateTable
CREATE TABLE "RetailDeliveryFeeSwitch" (
    "id" TEXT NOT NULL,
    "kind" "RdfSwitchKind" NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "basisRetailCents" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailDeliveryFeeSwitch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailDeliveryFeeSwitch_kind_startsOn_key" ON "RetailDeliveryFeeSwitch"("kind", "startsOn");

-- CreateIndex
CREATE INDEX "RetailDeliveryFeeSwitch_startsOn_idx" ON "RetailDeliveryFeeSwitch"("startsOn");

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "replacementOfInvoiceId" TEXT;
