-- Additive (Batch O-4). One new table and one enum; nothing existing is changed. Prices only change when the nightly job
-- applies a PENDING row on or after its start day, so with no rows nothing behaves differently.
CREATE TYPE "ScheduledPriceChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED', 'FAILED');

CREATE TABLE "ScheduledPriceChange" (
  "id" TEXT NOT NULL,
  "applianceTypeId" TEXT NOT NULL,
  "newPriceCents" INTEGER NOT NULL,
  "effectiveOn" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledPriceChangeStatus" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "priceAtSchedulingCents" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "priceBeforeApplyCents" INTEGER,
  "failureMessage" TEXT,
  CONSTRAINT "ScheduledPriceChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduledPriceChange_price_check" CHECK ("newPriceCents" >= 0 AND "priceAtSchedulingCents" >= 0)
);
CREATE INDEX "ScheduledPriceChange_status_effectiveOn_idx" ON "ScheduledPriceChange"("status", "effectiveOn");
CREATE INDEX "ScheduledPriceChange_applianceTypeId_status_idx" ON "ScheduledPriceChange"("applianceTypeId", "status");
-- One waiting change per appliance type per start day, so a double click cannot stack two.
CREATE UNIQUE INDEX "ScheduledPriceChange_one_pending_per_day" ON "ScheduledPriceChange"("applianceTypeId", "effectiveOn") WHERE "status" = 'PENDING';
ALTER TABLE "ScheduledPriceChange" ADD CONSTRAINT "ScheduledPriceChange_applianceTypeId_fkey" FOREIGN KEY ("applianceTypeId") REFERENCES "ApplianceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
