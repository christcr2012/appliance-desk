-- Late-delivery credit (owner decision IN-26, 2026-10-03). Additive only.
-- The proration setting first shipped under an "early return" name in
-- 20261003270000; the rule was a misreading, so the value moves to its real
-- name here and the old column is left in place (never read again).
ALTER TABLE "BusinessSettings" ADD COLUMN "lateDeliveryProrationBasis" TEXT NOT NULL DEFAULT 'MONTHLY_DIV_30';
UPDATE "BusinessSettings" SET "lateDeliveryProrationBasis" = "earlyReturnProrationBasis";

-- How much of a Stripe-applied credit has been shown on a mirrored bill so far.
-- Credits that already exist count as fully shown, so nothing old is ever
-- relabeled on a new bill.
ALTER TABLE "CustomerCredit" ADD COLUMN "shownCents" INTEGER NOT NULL DEFAULT 0;
UPDATE "CustomerCredit" SET "shownCents" = "amountCents";

-- The Colorado date a job's work was actually done (staff-entered at completion).
ALTER TABLE "Job" ADD COLUMN "performedOn" TIMESTAMP(3);

-- An agreement item that was not on the delivery visit that started billing.
CREATE TABLE "PendingDelivery" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "rentalLineId" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    "originalJobId" TEXT NOT NULL,
    "originalDeliveryDate" TIMESTAMP(3) NOT NULL,
    "deliveredOn" TIMESTAMP(3),
    "deliveredJobId" TEXT,
    "removedAt" TIMESTAMP(3),
    "creditId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PendingDelivery_creditId_key" ON "PendingDelivery"("creditId");
CREATE UNIQUE INDEX "PendingDelivery_originalJobId_applianceId_key" ON "PendingDelivery"("originalJobId", "applianceId");
CREATE INDEX "PendingDelivery_agreementId_idx" ON "PendingDelivery"("agreementId");
CREATE INDEX "PendingDelivery_applianceId_idx" ON "PendingDelivery"("applianceId");
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_originalJobId_fkey" FOREIGN KEY ("originalJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_deliveredJobId_fkey" FOREIGN KEY ("deliveredJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
