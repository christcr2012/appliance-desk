-- Batch C, P2-D: a maintenance request records which property the visit is for.
ALTER TABLE "MaintenanceRequest" ADD COLUMN "serviceAddressId" TEXT;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_serviceAddressId_fkey"
  FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MaintenanceRequest_serviceAddressId_idx" ON "MaintenanceRequest"("serviceAddressId");
-- Filled in only when the customer has exactly one address. Otherwise it stays empty and the scheduler picks one.
UPDATE "MaintenanceRequest" SET "serviceAddressId" =
  (SELECT MIN(a."id") FROM "ServiceAddress" a WHERE a."customerId" = "MaintenanceRequest"."customerId" HAVING COUNT(*) = 1);
