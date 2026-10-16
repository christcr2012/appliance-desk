ALTER TABLE "Estimate"
  ADD COLUMN "deliveryOffer" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "deliveryOfferVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryRequested" JSONB,
  ADD COLUMN "deliveryRequestedAt" TIMESTAMP(3),
  ADD COLUMN "customerAutoFinishEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job"
  ADD COLUMN "requestedDelivery" JSONB,
  ADD COLUMN "requestedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "confirmedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "originalConfirmedDeliveryFor" TIMESTAMP(3),
  ADD COLUMN "approvedTripFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approvedTripFeeReason" TEXT;
ALTER TABLE "BusinessSettings"
  ADD COLUMN "deliveryMorningStartHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "deliveryMorningEndHour" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "deliveryAfternoonStartHour" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "deliveryAfternoonEndHour" INTEGER NOT NULL DEFAULT 17,
  ADD COLUMN "relocationFeeCents" INTEGER NOT NULL DEFAULT 7500,
  ADD COLUMN "missedTripFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "drivingOriginAddress" TEXT NOT NULL DEFAULT 'Greeley, CO';
ALTER TABLE "Job" ADD CONSTRAINT "W24_trip_fee_nonnegative" CHECK ("approvedTripFeeCents" >= 0);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "W24_trip_fee_nonnegative" CHECK ("missedTripFeeCents" >= 0);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "W24_relocation_nonnegative" CHECK ("relocationFeeCents" >= 0);
