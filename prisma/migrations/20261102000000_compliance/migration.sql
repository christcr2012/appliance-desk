-- Additive (CMP-1: compliance center). Two new tables only: the owner's
-- business facts (ComplianceProfile, one row) and one row per obligation
-- period (ComplianceFiling). The EIN is stored encrypted (einEncrypted,
-- AES-256-GCM via src/lib/field-crypto.ts) with only its last 4 in the
-- clear; nothing existing is removed or rewritten.

-- CreateTable
CREATE TABLE "ComplianceProfile" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "entityType" TEXT NOT NULL DEFAULT 'SINGLE_MEMBER_LLC',
    "einLast4" CHAR(4),
    "einEncrypted" TEXT,
    "sosReportMonth" INTEGER,
    "truckGvwrLbs" INTEGER,
    "employees" INTEGER NOT NULL DEFAULT 0,
    "hasHomeOffice" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceFiling" (
    "id" TEXT NOT NULL,
    "obligationKey" VARCHAR(60) NOT NULL,
    "periodKey" VARCHAR(20) NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "actOn" TIMESTAMP(3) NOT NULL,
    "preparedData" JSONB,
    "preparedHash" CHAR(64),
    "outputFileUrl" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmation" VARCHAR(200),
    "note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "autoRetired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ComplianceFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceFiling_obligationKey_periodKey_key" ON "ComplianceFiling"("obligationKey", "periodKey");

-- CreateIndex
CREATE INDEX "ComplianceFiling_state_actOn_idx" ON "ComplianceFiling"("state", "actOn");
