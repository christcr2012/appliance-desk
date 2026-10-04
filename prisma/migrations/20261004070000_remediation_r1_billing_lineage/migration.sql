-- Remediation Batch R1: durable first-delivery billing fact and exclusive handoff lease.
ALTER TYPE "HandoffStatus" ADD VALUE 'IN_FLIGHT';

ALTER TABLE "JobBillingHandoff"
  ADD COLUMN "claimedAt" TIMESTAMP(3);

ALTER TABLE "RentalAgreement"
  ADD COLUMN "firstDeliveredOn" TIMESTAMP(3);

-- Historical agreements that already started billing predate the explicit delivery fact.
-- billingStartedAt is the best-known approximation for those rows; agreements that never
-- billed deliberately remain NULL rather than inventing a delivery date.
UPDATE "RentalAgreement"
SET "firstDeliveredOn" = "billingStartedAt"
WHERE "billingStartedAt" IS NOT NULL
  AND "firstDeliveredOn" IS NULL;
