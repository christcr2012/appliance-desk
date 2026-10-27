-- CMP-5: hiring readiness. Additive only: the ComplianceProfile gains
-- the first employee's start date (the Colorado new-hire report is due
-- 20 days after it), the books gain a PAYROLL journal source and the
-- two payroll system accounts, and PayrollImport keeps one row per
-- imported pay run (provider totals only — no employee-level data).

ALTER TABLE "ComplianceProfile" ADD COLUMN "firstHireDate" TIMESTAMP(3);

ALTER TYPE "JournalSourceType" ADD VALUE 'PAYROLL';

CREATE TABLE "PayrollImport" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "payDate" DATE NOT NULL,
    "grossWagesCents" INTEGER NOT NULL,
    "employerTaxesCents" INTEGER NOT NULL,
    "employeeTaxesCents" INTEGER,
    "withdrawnCents" INTEGER NOT NULL,
    "providerName" TEXT,
    "sourceFileName" TEXT,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollImport_fileHash_rowIndex_key" ON "PayrollImport"("fileHash", "rowIndex");
CREATE INDEX "PayrollImport_payDate_idx" ON "PayrollImport"("payDate");

-- Chart rows for existing databases (the chart in code lists them too):
-- wages land on Schedule C line 26, the business's payroll-tax share on
-- line 23 (taxes and licenses).
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","scheduleCLine","createdAt","updatedAt")
VALUES
 ('payroll_wages','WAGES','Wages','EXPENSE','Pay for employees, before anything is taken out',FALSE,TRUE,97,'26',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('payroll_employer_taxes','EMPLOYER_PAYROLL_TAXES','Payroll taxes (business share)','EXPENSE','The business''s own share of payroll taxes: the Social Security and Medicare match, unemployment insurance and the FAMLI employer share',FALSE,TRUE,98,'23',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("systemRole") DO NOTHING;
