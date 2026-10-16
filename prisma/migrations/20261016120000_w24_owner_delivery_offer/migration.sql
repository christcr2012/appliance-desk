ALTER TABLE "Estimate"
  ADD COLUMN "deliveryOffer" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "deliveryOfferVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryRequested" JSONB,
  ADD COLUMN "deliveryRequestedAt" TIMESTAMP(3),
  ADD COLUMN "customerAutoFinishEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deliveryRouteProof" JSONB;
ALTER TABLE "Job"
  ADD COLUMN "noShowCause" TEXT,
  ADD COLUMN "noShowEvidence" TEXT,
  ADD COLUMN "requestedDelivery" JSONB,
  ADD COLUMN "requestedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "confirmedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "originalConfirmedDeliveryFor" TIMESTAMP(3),
  ADD COLUMN "approvedTripFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approvedTripFeeReason" TEXT,
  ADD COLUMN "tripFeeApprovedAt" TIMESTAMP(3),
  ADD COLUMN "tripFeeApprovedByUserId" TEXT,
  ADD COLUMN "approvedRelocationFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "relocationFeeApprovedAt" TIMESTAMP(3),
  ADD COLUMN "relocationFeeApprovedByUserId" TEXT,
  ADD COLUMN "relocationFeeEvidence" TEXT;
ALTER TABLE "BusinessSettings"
  ADD COLUMN "deliveryMorningStartHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "deliveryMorningEndHour" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "deliveryAfternoonStartHour" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "deliveryAfternoonEndHour" INTEGER NOT NULL DEFAULT 17,
  ADD COLUMN "relocationFeeCents" INTEGER NOT NULL DEFAULT 7500,
  ADD COLUMN "missedTripFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "drivingOriginAddress" TEXT NOT NULL DEFAULT 'UNVERIFIED: owner must choose central Greeley origin',
  ADD COLUMN "drivingOriginVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "drivingOriginSourceReference" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "W24_trip_fee_nonnegative" CHECK ("approvedTripFeeCents" >= 0);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "W24_trip_fee_nonnegative" CHECK ("missedTripFeeCents" >= 0);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "W24_relocation_nonnegative" CHECK ("relocationFeeCents" >= 0);
ALTER TABLE "RentalAgreement"
  ADD COLUMN "deliveryOffer" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "deliveryOfferVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryOfferActorUserId" TEXT,
  ADD COLUMN "deliveryRequested" JSONB,
  ADD COLUMN "deliveryRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryRouteProof" JSONB;
ALTER TYPE "ProviderOperationKind" ADD VALUE IF NOT EXISTS 'TRIP_FEE_INVOICE_ITEM';
ALTER TYPE "ProviderOperationKind" ADD VALUE IF NOT EXISTS 'RELOCATION_INVOICE_ITEM';
