-- Additive (Batch O-4, part 2). A scheduled price change can now be for a rental set (package) as well as an appliance
-- type. Existing rows all have an appliance type and stay valid; with no package rows nothing behaves differently.
ALTER TABLE "ScheduledPriceChange" ALTER COLUMN "applianceTypeId" DROP NOT NULL;
ALTER TABLE "ScheduledPriceChange" ADD COLUMN "packageId" TEXT;
ALTER TABLE "ScheduledPriceChange" ADD CONSTRAINT "ScheduledPriceChange_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Exactly one target: an appliance type or a set, never both and never neither.
ALTER TABLE "ScheduledPriceChange" ADD CONSTRAINT "ScheduledPriceChange_one_target_check" CHECK (("applianceTypeId" IS NULL) <> ("packageId" IS NULL));
CREATE INDEX "ScheduledPriceChange_packageId_status_idx" ON "ScheduledPriceChange"("packageId", "status");
-- One waiting change per set per start day, so a double click cannot stack two.
CREATE UNIQUE INDEX "ScheduledPriceChange_one_pending_per_package_day" ON "ScheduledPriceChange"("packageId", "effectiveOn") WHERE "status" = 'PENDING' AND "packageId" IS NOT NULL;
