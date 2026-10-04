-- Batch C P2-A (data): honest custody evidence for appliances that are with a customer right now.
-- 1. Appliances now with a customer (RENTED / AWAITING_PICKUP) that have a COMPLETED delivery/installation or swap job.
INSERT INTO "ApplianceCustodyEpisode" ("id","applianceId","customerId","serviceAddressId","agreementId","startedOn","startEvidence","startJobId","createdAt")
SELECT DISTINCT ON (ja."applianceId") 'bf_' || ja."applianceId", ja."applianceId", j."customerId", j."serviceAddressId", j."agreementId",
       -- Colorado midnight of the completion's Denver date, written as naive UTC (completedAt is timestamptz,
       -- startedOn is timestamp(3)); independent of the session time zone.
       COALESCE(j."performedOn",
                (date_trunc('day', j."completedAt" AT TIME ZONE 'America/Denver') AT TIME ZONE 'America/Denver') AT TIME ZONE 'UTC'),
       'JOB', j."id", NOW()
FROM "JobAppliance" ja JOIN "Job" j ON j."id" = ja."jobId" JOIN "Appliance" a ON a."id" = ja."applianceId"
WHERE a."status" IN ('RENTED','AWAITING_PICKUP') AND j."status" = 'COMPLETED' AND j."customerId" IS NOT NULL
  AND j."type" IN ('DELIVERY','INSTALLATION','SWAP') AND j."completedAt" IS NOT NULL
ORDER BY ja."applianceId", j."completedAt" DESC;

-- 2. Remaining RENTED / AWAITING_PICKUP appliances: customer from the latest assignment's agreement, date unknown.
INSERT INTO "ApplianceCustodyEpisode" ("id","applianceId","customerId","serviceAddressId","agreementId","startedOn","startEvidence","createdAt")
SELECT DISTINCT ON (a."id") 'bf_' || a."id", a."id", g."customerId", g."serviceAddressId", g."id", NULL, 'ESTIMATED', NOW()
FROM "Appliance" a JOIN "ApplianceAssignment" s ON s."applianceId" = a."id"
  JOIN "RentalLine" l ON l."id" = s."rentalLineId" JOIN "RentalAgreement" g ON g."id" = l."agreementId"
WHERE a."status" IN ('RENTED','AWAITING_PICKUP')
  AND NOT EXISTS (SELECT 1 FROM "ApplianceCustodyEpisode" e WHERE e."applianceId" = a."id")
ORDER BY a."id", s."assignedAt" DESC;
