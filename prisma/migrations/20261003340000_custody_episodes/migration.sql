-- Batch C P2-A (structure): who physically has each appliance.
CREATE TYPE "CustodyEvidence" AS ENUM ('JOB', 'ESTIMATED', 'MANUAL');

CREATE TABLE "ApplianceCustodyEpisode" (
    "id" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceAddressId" TEXT,
    "agreementId" TEXT,
    "startedOn" TIMESTAMP(3),
    "startEvidence" "CustodyEvidence" NOT NULL,
    "startJobId" TEXT,
    "closedAt" TIMESTAMP(3),
    "endedOn" TIMESTAMP(3),
    "endEvidence" "CustodyEvidence",
    "endJobId" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplianceCustodyEpisode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplianceCustodyEpisode_startJobId_applianceId_key" ON "ApplianceCustodyEpisode"("startJobId", "applianceId");
CREATE UNIQUE INDEX "ApplianceCustodyEpisode_endJobId_applianceId_key" ON "ApplianceCustodyEpisode"("endJobId", "applianceId");
CREATE INDEX "ApplianceCustodyEpisode_applianceId_closedAt_idx" ON "ApplianceCustodyEpisode"("applianceId", "closedAt");
CREATE INDEX "ApplianceCustodyEpisode_customerId_idx" ON "ApplianceCustodyEpisode"("customerId");

ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "ApplianceCustodyEpisode_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "ApplianceCustodyEpisode_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "ApplianceCustodyEpisode_serviceAddressId_fkey" FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "ApplianceCustodyEpisode_startJobId_fkey" FOREIGN KEY ("startJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "ApplianceCustodyEpisode_endJobId_fkey" FOREIGN KEY ("endJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one open episode per appliance: a second open one is a unique violation, never a silent overwrite.
CREATE UNIQUE INDEX "ApplianceCustodyEpisode_one_open_per_appliance" ON "ApplianceCustodyEpisode"("applianceId") WHERE "closedAt" IS NULL;
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "Custody_closed_consistent" CHECK (("closedAt" IS NULL) = ("endEvidence" IS NULL));
ALTER TABLE "ApplianceCustodyEpisode" ADD CONSTRAINT "Custody_job_evidence_has_date" CHECK ("startEvidence" <> 'JOB' OR "startedOn" IS NOT NULL);
