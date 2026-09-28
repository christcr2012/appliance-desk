-- Rental lifecycle (2026-09-28): separate "signed" from "delivered", and
-- "agreement ended" from "machine back and checked". Purely additive —
-- two new enum values, one new table, one new settings column with a
-- default. No existing row changes meaning.

ALTER TYPE "ApplianceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PICKUP';
ALTER TYPE "ApplianceStatus" ADD VALUE IF NOT EXISTS 'AWAITING_INSPECTION';

CREATE TABLE "ApplianceInspection" (
    "id" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "condition" TEXT,
    "inspectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplianceInspection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplianceInspection_applianceId_idx" ON "ApplianceInspection"("applianceId");

ALTER TABLE "ApplianceInspection" ADD CONSTRAINT "ApplianceInspection_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessSettings" ADD COLUMN "inspectionChecklist" JSONB NOT NULL DEFAULT '[]';
