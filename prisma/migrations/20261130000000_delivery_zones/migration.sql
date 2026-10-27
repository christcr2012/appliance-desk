-- Additive (ZONE-1: delivery zones found from the address). New settings columns with the IN-06 starting values, a
-- frozen zone snapshot on estimates and agreements, and a separate table for a customer address's map position.
-- Nothing existing is removed or rewritten; the old service-area city/ZIP columns stay (no longer read).

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN "deliveryZones" JSONB NOT NULL DEFAULT '[{"name":"Local — free delivery","outerMiles":15,"deliveryCents":0,"pickupCents":0,"color":"GREEN"},{"name":"Nearby","outerMiles":30,"deliveryCents":7500,"pickupCents":7500,"color":"BLUE"},{"name":"Extended","outerMiles":50,"deliveryCents":12500,"pickupCents":12500,"color":"AMBER"}]',
ADD COLUMN "deliveryMaxMiles" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN "zoneCenter" JSONB NOT NULL DEFAULT '{"lat":40.4233,"lon":-104.7091}',
ADD COLUMN "zoneDistanceMethod" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
ADD COLUMN "showDeliveryPricesOnWebsite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN "deliveryZoneSnapshot" JSONB,
ADD COLUMN "deliveryZoneSnapshotAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RentalAgreement" ADD COLUMN "deliveryZoneSnapshot" JSONB;

-- CreateTable
CREATE TABLE "ServiceAddressGeocode" (
    "serviceAddressId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "addressHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "geocodedAt" TIMESTAMP(3) NOT NULL,
    "geocodedByUserId" TEXT,

    CONSTRAINT "ServiceAddressGeocode_pkey" PRIMARY KEY ("serviceAddressId")
);

-- AddForeignKey
ALTER TABLE "ServiceAddressGeocode" ADD CONSTRAINT "ServiceAddressGeocode_serviceAddressId_fkey" FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
