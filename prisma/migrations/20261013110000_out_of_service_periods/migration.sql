-- W-21A (Batch W Amendment B, D-WB8 case 3): a machine taken for repair with no replacement yet is out of service
-- until a machine is back; the customer is credited the days without it. Additive.

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "outOfServiceEscalationDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "OutOfServicePeriod" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "rentalLineId" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    "startedOn" TIMESTAMP(3) NOT NULL,
    "startJobId" TEXT NOT NULL,
    "endedOn" TIMESTAMP(3),
    "endJobId" TEXT,
    "endReason" TEXT,
    "replacementApplianceId" TEXT,
    "creditId" TEXT,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "OutOfServicePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutOfServicePeriod_creditId_key" ON "OutOfServicePeriod"("creditId");

-- CreateIndex
CREATE INDEX "OutOfServicePeriod_agreementId_endedOn_idx" ON "OutOfServicePeriod"("agreementId", "endedOn");

-- CreateIndex
CREATE INDEX "OutOfServicePeriod_applianceId_endedOn_idx" ON "OutOfServicePeriod"("applianceId", "endedOn");

-- CreateIndex
CREATE UNIQUE INDEX "OutOfServicePeriod_startJobId_applianceId_key" ON "OutOfServicePeriod"("startJobId", "applianceId");

-- AddForeignKey
ALTER TABLE "OutOfServicePeriod" ADD CONSTRAINT "OutOfServicePeriod_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfServicePeriod" ADD CONSTRAINT "OutOfServicePeriod_rentalLineId_fkey" FOREIGN KEY ("rentalLineId") REFERENCES "RentalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutOfServicePeriod" ADD CONSTRAINT "OutOfServicePeriod_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one open period per machine; dates in order; a closed period says why.
CREATE UNIQUE INDEX "OutOfServicePeriod_one_open_per_appliance" ON "OutOfServicePeriod"("applianceId") WHERE "endedOn" IS NULL;
ALTER TABLE "OutOfServicePeriod" ADD CONSTRAINT "OutOfServicePeriod_dates_in_order" CHECK ("endedOn" IS NULL OR "endedOn" >= "startedOn");
ALTER TABLE "OutOfServicePeriod" ADD CONSTRAINT "OutOfServicePeriod_closed_has_reason" CHECK (("endedOn" IS NULL) = ("endReason" IS NULL));
ALTER TABLE "OutOfServicePeriod" ADD CONSTRAINT "OutOfServicePeriod_end_reason_known" CHECK ("endReason" IS NULL OR "endReason" IN ('REPLACED', 'SAME_MACHINE_BACK', 'CLOSED_BY_OWNER'));
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_out_of_service_days_range" CHECK ("outOfServiceEscalationDays" BETWEEN 1 AND 60);
