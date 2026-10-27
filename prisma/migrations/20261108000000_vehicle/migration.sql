-- OPS-3: vehicle profile, mileage log and the IRS mileage rate (additive only).
CREATE TYPE "MileageMethod" AS ENUM ('STANDARD_RATE', 'ACTUAL_COSTS');
CREATE TYPE "MileageTripSource" AS ENUM ('ROUTE', 'MANUAL');

ALTER TABLE "BusinessSettings" ADD COLUMN "mileageMethod" "MileageMethod" NOT NULL DEFAULT 'STANDARD_RATE';
ALTER TABLE "BusinessSettings" ADD COLUMN "vehicleMedicalCardRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "FleetVehicle" (
  "id" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "vin" TEXT,
  "plate" TEXT,
  "gvwrLbs" INTEGER NOT NULL,
  "registrationMonth" INTEGER,
  "odometerAtPurchase" INTEGER NOT NULL DEFAULT 0,
  "maintenanceEveryMiles" INTEGER,
  "maintenanceEveryMonths" INTEGER,
  "lastMaintenanceOn" TIMESTAMP(3),
  "lastMaintenanceMiles" INTEGER,
  "medicalCardExpiresOn" TIMESTAMP(3),
  "notes" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FleetVehicle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FleetVehicle_gvwr_positive" CHECK ("gvwrLbs" > 0),
  CONSTRAINT "FleetVehicle_registration_month" CHECK ("registrationMonth" IS NULL OR ("registrationMonth" BETWEEN 1 AND 12))
);

CREATE TABLE "MileageTrip" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "tripDate" TIMESTAMP(3) NOT NULL,
  "startOdometer" INTEGER NOT NULL,
  "endOdometer" INTEGER,
  "miles" INTEGER,
  "purpose" TEXT NOT NULL,
  "source" "MileageTripSource" NOT NULL,
  "stops" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MileageTrip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MileageTrip_odometer_order" CHECK ("endOdometer" IS NULL OR "endOdometer" >= "startOdometer"),
  CONSTRAINT "MileageTrip_miles_match" CHECK (("endOdometer" IS NULL AND "miles" IS NULL) OR ("miles" = "endOdometer" - "startOdometer"))
);
CREATE INDEX "MileageTrip_vehicleId_tripDate_idx" ON "MileageTrip"("vehicleId", "tripDate");
-- One route-day trip per vehicle per day, so a second press of "Start" can never double-count a day.
CREATE UNIQUE INDEX "MileageTrip_one_route_trip_per_day" ON "MileageTrip"("vehicleId", "tripDate") WHERE "source" = 'ROUTE';
ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "FleetVehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: the IRS business mileage rate for 2026 is 72.5 cents a mile (stored in tenths of a cent: 725).
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-us-mileage-rate-20260101', 'us.mileage_rate', '725', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/newsroom/irs-sets-2026-business-standard-mileage-rate-at-725-cents-per-mile',
   'Summary of IRS Notice 2026-10: the standard mileage rate for business use of a car in 2026 is 72.5 cents per mile. Checked from a secondary summary; confirm on irs.gov.',
   '2026-10-26T12:00:00Z', true, false, NULL, NULL, now());
