-- OPS-3: link a vehicle to the insurance policy that covers it (additive, optional).
ALTER TABLE "FleetVehicle" ADD COLUMN "insurancePolicyId" TEXT;
CREATE INDEX "FleetVehicle_insurancePolicyId_idx" ON "FleetVehicle"("insurancePolicyId");
ALTER TABLE "FleetVehicle" ADD CONSTRAINT "FleetVehicle_insurancePolicyId_fkey" FOREIGN KEY ("insurancePolicyId") REFERENCES "OwnerInsurancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
