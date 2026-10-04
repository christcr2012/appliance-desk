-- Batch C section 8: a waiting item can be swapped for another unit of the same type, and an item that is
-- permanently cancelled lowers its rental line's price from the next billing period (kept as a never-edited record).

ALTER TABLE "PendingDelivery" ADD COLUMN "substituteApplianceId" TEXT;
ALTER TABLE "PendingDelivery" ADD COLUMN "substituteJobId" TEXT;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_substituteApplianceId_fkey"
  FOREIGN KEY ("substituteApplianceId") REFERENCES "Appliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_substituteJobId_fkey"
  FOREIGN KEY ("substituteJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_substitute_pair"
  CHECK (("substituteApplianceId" IS NULL) = ("substituteJobId" IS NULL));
CREATE INDEX "PendingDelivery_substituteApplianceId_idx" ON "PendingDelivery"("substituteApplianceId");

CREATE TABLE "RentalLineAmendment" (
  "id" TEXT NOT NULL,
  "rentalLineId" TEXT NOT NULL,
  "pendingDeliveryId" TEXT NOT NULL,
  "previousMonthlyPriceCents" INTEGER NOT NULL,
  "newMonthlyPriceCents" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RentalLineAmendment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RentalLineAmendment_prices_check" CHECK ("previousMonthlyPriceCents" >= 0 AND "newMonthlyPriceCents" >= 0 AND "newMonthlyPriceCents" <= "previousMonthlyPriceCents")
);
CREATE UNIQUE INDEX "RentalLineAmendment_pendingDeliveryId_key" ON "RentalLineAmendment"("pendingDeliveryId");
CREATE INDEX "RentalLineAmendment_rentalLineId_idx" ON "RentalLineAmendment"("rentalLineId");
ALTER TABLE "RentalLineAmendment" ADD CONSTRAINT "RentalLineAmendment_rentalLineId_fkey"
  FOREIGN KEY ("rentalLineId") REFERENCES "RentalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An amendment can never be changed or deleted.
CREATE FUNCTION "rental_line_amendment_append_only"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Rental line amendments cannot be changed or deleted.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "RentalLineAmendment_append_only" BEFORE UPDATE OR DELETE ON "RentalLineAmendment"
  FOR EACH ROW EXECUTE FUNCTION "rental_line_amendment_append_only"();
