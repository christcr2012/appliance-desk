-- Additive (Batch O-2A). One new table. No rows exist after this runs, so every owner, admin and staff member keeps
-- exactly the access they have today until the owner limits an admin.
CREATE TABLE "StaffCapabilityOverride" (
  "userId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffCapabilityOverride_pkey" PRIMARY KEY ("userId", "capability")
);
