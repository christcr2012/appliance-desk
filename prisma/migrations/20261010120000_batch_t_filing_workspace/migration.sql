CREATE TYPE "TaxFilingAccountKind" AS ENUM ('SALES_RETURN', 'USE_TAX_RETURN');
CREATE TYPE "TaxAmendmentStatus" AS ENUM ('OPEN', 'FILED', 'HANDLED_OUTSIDE');

ALTER TABLE "TaxFilingAccount"
  ADD COLUMN "kind" "TaxFilingAccountKind" NOT NULL DEFAULT 'SALES_RETURN',
  ADD COLUMN "firstPeriodStart" TIMESTAMP(3),
  ADD COLUMN "licenseExpiresOn" TIMESTAMP(3),
  ADD COLUMN "reminderDaysBefore" INTEGER[] NOT NULL DEFAULT ARRAY[7, 2]::INTEGER[],
  ADD COLUMN "emailReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deductionLabels" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "screenLabels" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "filingNotes" TEXT,
  ADD COLUMN "excelUploadAvailable" BOOLEAN,
  ADD COLUMN "bulkXmlAvailable" BOOLEAN,
  ADD COLUMN "setupCheckedOn" TIMESTAMP(3);

ALTER TABLE "TaxJurisdiction"
  ADD COLUMN "filingCode" TEXT,
  ADD COLUMN "filingOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "serviceFeeMilliPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "useTaxFilingAccountId" TEXT;

ALTER TABLE "TaxFilingPeriod"
  ADD COLUMN "legalDueOn" TIMESTAMP(3),
  ADD COLUMN "dueOnEditedByUserId" TEXT,
  ADD COLUMN "zeroReturn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paidOn" TIMESTAMP(3),
  ADD COLUMN "confirmationPhotoId" TEXT,
  ADD COLUMN "entryProgress" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "TaxFilingAmendment" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "TaxAmendmentStatus" NOT NULL DEFAULT 'OPEN',
  "packet" JSONB NOT NULL,
  "additionalTaxCents" INTEGER NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "filedOn" TIMESTAMP(3),
  "paidOn" TIMESTAMP(3),
  "confirmationNumber" TEXT,
  "amountPaidCents" INTEGER,
  "filedByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaxFilingAmendment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxFilingAmendment_periodId_sequence_key"
  ON "TaxFilingAmendment"("periodId", "sequence");

CREATE INDEX "TaxFilingAmendment_status_detectedAt_idx"
  ON "TaxFilingAmendment"("status", "detectedAt");

CREATE INDEX "TaxJurisdiction_useTaxFilingAccountId_idx"
  ON "TaxJurisdiction"("useTaxFilingAccountId");

ALTER TABLE "TaxJurisdiction"
  ADD CONSTRAINT "TaxJurisdiction_useTaxFilingAccountId_fkey"
  FOREIGN KEY ("useTaxFilingAccountId") REFERENCES "TaxFilingAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxFilingAmendment"
  ADD CONSTRAINT "TaxFilingAmendment_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "TaxFilingPeriod"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
