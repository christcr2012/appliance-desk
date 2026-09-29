-- Estimates for property-manager / bulk & multi-unit deals (2026-09-29,
-- docs/DECISIONS.md has the full writeup). Purely additive: two new
-- tables, no existing column changes meaning.

CREATE TYPE "EstimateStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'VIEWED',
    'APPROVED',
    'CHANGES_REQUESTED',
    'DECLINED',
    'EXPIRED',
    'CONVERTED'
);

CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "estimateNumber" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "clientMessage" TEXT,
    "internalNotes" TEXT,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMPTZ,
    "sentAt" TIMESTAMPTZ,
    "viewedAt" TIMESTAMPTZ,
    "respondedAt" TIMESTAMPTZ,
    "approverName" TEXT,
    "approverEmail" TEXT,
    "approverIpAddress" TEXT,
    "changesRequestedMessage" TEXT,
    "declineReason" TEXT,
    "convertedAt" TIMESTAMPTZ,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "Estimate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
);

CREATE UNIQUE INDEX "Estimate_estimateNumber_key" ON "Estimate"("estimateNumber");
CREATE INDEX "Estimate_customerId_idx" ON "Estimate"("customerId");
CREATE INDEX "Estimate_status_idx" ON "Estimate"("status");

CREATE TABLE "EstimateLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "estimateId" TEXT NOT NULL,
    "serviceAddressId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "oneTimeFeeCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "EstimateLineItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE,
    CONSTRAINT "EstimateLineItem_serviceAddressId_fkey" FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id")
);

CREATE INDEX "EstimateLineItem_estimateId_idx" ON "EstimateLineItem"("estimateId");

-- A draft agreement can be traced back to the estimate that produced
-- it (see the model comment in prisma/schema.prisma).
ALTER TABLE "RentalAgreement" ADD COLUMN "sourceEstimateId" TEXT;
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_sourceEstimateId_fkey" FOREIGN KEY ("sourceEstimateId") REFERENCES "Estimate"("id");
CREATE INDEX "RentalAgreement_sourceEstimateId_idx" ON "RentalAgreement"("sourceEstimateId");
