-- W-23: tenant/location privacy is separate from the paying customer.
ALTER TABLE "Customer" ADD COLUMN "locationContactPolicy" JSONB NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN "locationContactPolicyAt" TIMESTAMP(3), ADD COLUMN "locationContactPolicyByUserId" TEXT;
ALTER TABLE "ServiceAddress" ADD COLUMN "unitLabel" TEXT, ADD COLUMN "accessNotes" TEXT,
 ADD COLUMN "locationContactPolicy" JSONB,
 ADD COLUMN "locationContactPolicyAt" TIMESTAMP(3),
 ADD COLUMN "locationContactPolicyByUserId" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "tenantContactRetentionMonths" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_tenant_retention_bounds"
 CHECK ("tenantContactRetentionMonths" BETWEEN 1 AND 120);
CREATE TABLE "LocationContact" (
 "id" TEXT NOT NULL,
 "serviceAddressId" TEXT NOT NULL,
 "name" TEXT,
 "role" TEXT NOT NULL DEFAULT 'TENANT',
 "phone" TEXT,
 "email" TEXT,
 "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
 "startedAt" TIMESTAMP(3),
 "endedAt" TIMESTAMP(3),
 "erasedAt" TIMESTAMP(3),
 "repairTokenHash" TEXT,
 "repairTokenExpiresAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LocationContact_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LocationContact_erasure_integrity" CHECK
 ("erasedAt" IS NULL OR ("name" IS NULL AND "phone" IS NULL AND "email" IS NULL AND "repairTokenHash" IS NULL)),
 CONSTRAINT "LocationContact_valid_dates" CHECK
 ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt")
);
CREATE UNIQUE INDEX "LocationContact_repairTokenHash_key" ON "LocationContact"("repairTokenHash");
CREATE INDEX "LocationContact_serviceAddressId_endedAt_idx" ON "LocationContact"("serviceAddressId","endedAt");
CREATE INDEX "LocationContact_endedAt_erasedAt_idx" ON "LocationContact"("endedAt","erasedAt");
ALTER TABLE "LocationContact" ADD CONSTRAINT "LocationContact_serviceAddressId_fkey"
 FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
