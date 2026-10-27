-- CMP-3: supplier W-9 / TIN record (encrypted at rest) and one-time
-- W-9 request links. Additive only. The 1099 box mapping starts with the
-- two classifications that are not guesses: storage/warehouse rent is
-- Form 1099-MISC box 1 (rents); professional fees are 1099-NEC box 1.
ALTER TABLE "ExpenseCategory" ADD COLUMN "form1099Box" TEXT;
UPDATE "ExpenseCategory" SET "form1099Box" = 'MISC_1'
  WHERE "ledgerAccountId" IN (SELECT "id" FROM "LedgerAccount" WHERE "systemRole" = 'EXPENSE_STORAGE___WAREHOUSE_RENT');
UPDATE "ExpenseCategory" SET "form1099Box" = 'NEC_1'
  WHERE "ledgerAccountId" IN (SELECT "id" FROM "LedgerAccount" WHERE "systemRole" = 'EXPENSE_PROFESSIONAL_FEES__CPA__LEGAL');
ALTER TABLE "Supplier" ADD COLUMN "tinType" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "tinEncrypted" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "tinLast4" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "w9ReceivedOn" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "w9FileUrl" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "backupWithholding" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "W9Request" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "W9Request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "W9Request_tokenHash_key" ON "W9Request"("tokenHash");
CREATE INDEX "W9Request_supplierId_idx" ON "W9Request"("supplierId");

ALTER TABLE "W9Request" ADD CONSTRAINT "W9Request_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CMP-3: the payer identity for information returns, on the compliance profile.
ALTER TABLE "ComplianceProfile" ADD COLUMN "businessLegalName" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "businessAddress" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "businessCity" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "businessState" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "businessZip" TEXT;
ALTER TABLE "ComplianceProfile" ADD COLUMN "businessPhone" TEXT;
