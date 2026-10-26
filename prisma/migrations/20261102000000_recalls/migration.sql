-- OPS-1: product recalls and the safety-incident log. Additive only.

-- CreateEnum
CREATE TYPE "RecallMatchState" AS ENUM ('POSSIBLE', 'CONFIRMED', 'NOT_OURS', 'REMEDIED');
CREATE TYPE "SafetyIncidentDecision" AS ENUM ('PENDING', 'REPORTED', 'NOT_REPORTED');

-- AlterTable
ALTER TABLE "ApplianceType" ADD COLUMN "recallProductTerms" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Appliance" ADD COLUMN "recallHold" BOOLEAN NOT NULL DEFAULT false;

-- Starting search words for the two starter types (Chris can edit them; other types fall back to their own name).
UPDATE "ApplianceType" SET "recallProductTerms" = ARRAY['washer', 'washing machine'] WHERE "slug" = 'washer' AND cardinality("recallProductTerms") = 0;
UPDATE "ApplianceType" SET "recallProductTerms" = ARRAY['dryer', 'clothes dryer'] WHERE "slug" = 'dryer' AND cardinality("recallProductTerms") = 0;

-- CreateTable
CREATE TABLE "RecallMatch" (
    "id" TEXT NOT NULL,
    "recallId" TEXT NOT NULL,
    "recallNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "hazard" TEXT,
    "remedy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "applianceId" TEXT NOT NULL,
    "matchReason" TEXT NOT NULL,
    "state" "RecallMatchState" NOT NULL DEFAULT 'POSSIBLE',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecallMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecallWatchState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastSuccessAt" TIMESTAMP(3),
    "fullFleetRequestedAt" TIMESTAMP(3),
    "fullFleetCheckedAt" TIMESTAMP(3),
    "fullFleetCursor" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecallWatchState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "applianceId" TEXT,
    "maintenanceRequestId" TEXT,
    "jobId" TEXT,
    "description" TEXT NOT NULL,
    "markedByUserId" TEXT NOT NULL,
    "decision" "SafetyIncidentDecision" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecallMatch_state_idx" ON "RecallMatch"("state");
CREATE INDEX "RecallMatch_applianceId_idx" ON "RecallMatch"("applianceId");
CREATE UNIQUE INDEX "RecallMatch_recallId_applianceId_key" ON "RecallMatch"("recallId", "applianceId");
CREATE INDEX "SafetyIncident_decision_idx" ON "SafetyIncident"("decision");
CREATE INDEX "SafetyIncident_applianceId_idx" ON "SafetyIncident"("applianceId");
CREATE INDEX "SafetyIncident_maintenanceRequestId_idx" ON "SafetyIncident"("maintenanceRequestId");
CREATE INDEX "SafetyIncident_jobId_idx" ON "SafetyIncident"("jobId");

-- AddForeignKey
ALTER TABLE "RecallMatch" ADD CONSTRAINT "RecallMatch_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
