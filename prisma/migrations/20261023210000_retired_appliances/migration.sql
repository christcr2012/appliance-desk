-- Additive (Batch M-2, retired appliances). New tables, nullable/defaulted columns and chart rows only; nothing changes
-- until the owner chooses what to do with a retired appliance.
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'SCRAP_PAYMENT';

CREATE TYPE "RetiredPlanChoice" AS ENUM ('SELL', 'STRIP', 'SCRAP', 'DISPOSE', 'OTHER');

CREATE TABLE "RetiredAppliancePlan" (
  "applianceId" TEXT NOT NULL,
  "choice" "RetiredPlanChoice" NOT NULL,
  "note" TEXT,
  "remainder" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "decidedByUserId" TEXT NOT NULL,
  "doneOn" TIMESTAMP(3),
  "doneNote" TEXT,
  "doneByUserId" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetiredAppliancePlan_pkey" PRIMARY KEY ("applianceId")
);
CREATE INDEX "RetiredAppliancePlan_choice_doneOn_idx" ON "RetiredAppliancePlan"("choice", "doneOn");
ALTER TABLE "RetiredAppliancePlan" ADD CONSTRAINT "RetiredAppliancePlan_applianceId_fkey"
  FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetiredAppliancePlan" ADD CONSTRAINT "RetiredAppliancePlan_remainder_check"
  CHECK ("remainder" IS NULL OR "remainder" IN ('SCRAPPED', 'THROWN_AWAY'));

CREATE TABLE "ScrapPayment" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "receivedOn" TIMESTAMP(3) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "yardName" TEXT NOT NULL,
  "note" TEXT,
  "depositAccountId" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "voidedByUserId" TEXT,
  CONSTRAINT "ScrapPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScrapPayment_amount_check" CHECK ("amountCents" > 0)
);
CREATE UNIQUE INDEX "ScrapPayment_operationKey_key" ON "ScrapPayment"("operationKey");
CREATE INDEX "ScrapPayment_receivedOn_idx" ON "ScrapPayment"("receivedOn");

ALTER TABLE "PartStockMovement" ADD COLUMN "applianceId" TEXT;
CREATE INDEX "PartStockMovement_applianceId_idx" ON "PartStockMovement"("applianceId");
ALTER TABLE "PartStockMovement" ADD CONSTRAINT "PartStockMovement_applianceId_fkey"
  FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessSettings" ADD COLUMN "retiredFollowUpDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_retiredFollowUpDays_check"
  CHECK ("retiredFollowUpDays" >= 0 AND "retiredFollowUpDays" <= 365);

-- Chart rows for existing databases (the chart in code lists them too): scrap income, dump/disposal expense and its category.
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","createdAt","updatedAt")
VALUES
 ('retired_scrap_income','SCRAP_INCOME','Scrap sales','INCOME','Money from scrap yards for appliances and metal sold as scrap',FALSE,TRUE,95,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('retired_dump_fees','EXPENSE_DUMP_AND_DISPOSAL_FEES','Dump and disposal fees','EXPENSE','Dump and disposal fees',FALSE,TRUE,96,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("systemRole") DO NOTHING;

INSERT INTO "ExpenseCategory" ("id","name","description","ledgerAccountId","active","sortOrder","createdAt")
SELECT 'retired_dump_fees_category','Dump and disposal fees','Dump and disposal fees',a.id,TRUE,
       COALESCE((SELECT MAX("sortOrder") FROM "ExpenseCategory"),0)+1,CURRENT_TIMESTAMP
FROM "LedgerAccount" a WHERE a."systemRole"='EXPENSE_DUMP_AND_DISPOSAL_FEES'
AND NOT EXISTS (SELECT 1 FROM "ExpenseCategory" x WHERE x.name='Dump and disposal fees');
