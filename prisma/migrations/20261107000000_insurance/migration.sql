-- OPS-4: insurance policies, certificate requests and workers' compensation status (additive only).
CREATE TYPE "InsuranceKind" AS ENUM ('GENERAL_LIABILITY', 'COMMERCIAL_AUTO', 'EQUIPMENT', 'WORKERS_COMP', 'OTHER');
CREATE TYPE "WorkersCompStatus" AS ENUM ('NOT_SET', 'NO_EMPLOYEES_REJECTED', 'POLICY_IN_PLACE');

ALTER TABLE "BusinessSettings" ADD COLUMN "insuranceRemindFirstDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "BusinessSettings" ADD COLUMN "insuranceRemindSecondDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "BusinessSettings" ADD COLUMN "workersCompStatus" "WorkersCompStatus" NOT NULL DEFAULT 'NOT_SET';
ALTER TABLE "BusinessSettings" ADD COLUMN "workersCompEmployees" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD COLUMN "workersCompNote" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "workersCompFormSentOn" TIMESTAMP(3);
ALTER TABLE "BusinessSettings" ADD COLUMN "workersCompMailNumber" TEXT;

CREATE TABLE "OwnerInsurancePolicy" (
  "id" TEXT NOT NULL,
  "kind" "InsuranceKind" NOT NULL,
  "insurer" TEXT NOT NULL,
  "policyNumber" TEXT NOT NULL,
  "limitsText" TEXT,
  "annualPremiumCents" INTEGER,
  "effectiveOn" TIMESTAMP(3),
  "expiresOn" TIMESTAMP(3) NOT NULL,
  "agentName" TEXT,
  "agentEmail" TEXT,
  "certificateNote" TEXT,
  "notes" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerInsurancePolicy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerInsurancePolicy_expiresOn_idx" ON "OwnerInsurancePolicy"("expiresOn");

CREATE TABLE "InsuranceCertificateRequest" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "requesterName" TEXT NOT NULL,
  "requesterCompany" TEXT,
  "requesterEmail" TEXT NOT NULL,
  "holderText" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsuranceCertificateRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InsuranceCertificateRequest_policyId_requestedAt_idx" ON "InsuranceCertificateRequest"("policyId", "requestedAt");
ALTER TABLE "InsuranceCertificateRequest" ADD CONSTRAINT "InsuranceCertificateRequest_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "OwnerInsurancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
