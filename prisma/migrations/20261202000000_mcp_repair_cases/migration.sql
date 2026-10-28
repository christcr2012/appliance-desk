CREATE TYPE "RepairStage" AS ENUM ('PROPOSED', 'IN_PROGRESS', 'PR_OPEN', 'MERGED', 'DEPLOYED', 'VERIFIED', 'REJECTED', 'SUPERSEDED', 'FAILED', 'BLOCKED');

CREATE TABLE "RepairCase" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "sourceKind" VARCHAR(20) NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "expectedBehavior" VARCHAR(2000) NOT NULL,
  "howToCheck" VARCHAR(2000) NOT NULL,
  "baselineRevision" VARCHAR(40) NOT NULL,
  "stage" "RepairStage" NOT NULL DEFAULT 'PROPOSED',
  "prNumber" INTEGER,
  "mergeSha" VARCHAR(40),
  "deployedRevision" VARCHAR(40),
  "verifiedAt" TIMESTAMP(3),
  "blocker" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RepairCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepairCase_number_key" ON "RepairCase"("number");
CREATE UNIQUE INDEX "RepairCase_fingerprint_key" ON "RepairCase"("fingerprint");
CREATE INDEX "RepairCase_stage_updatedAt_idx" ON "RepairCase"("stage", "updatedAt");
CREATE INDEX "RepairCase_sourceKind_sourceId_sourceVersion_idx" ON "RepairCase"("sourceKind", "sourceId", "sourceVersion");

CREATE TABLE "RepairEvidence" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "ref" VARCHAR(200) NOT NULL,
  "status" VARCHAR(12) NOT NULL,
  "verifier" VARCHAR(40),
  "checkedAt" TIMESTAMP(3),
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepairEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RepairEvidence_caseId_createdAt_idx" ON "RepairEvidence"("caseId", "createdAt");
ALTER TABLE "RepairEvidence" ADD CONSTRAINT "RepairEvidence_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "RepairCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
