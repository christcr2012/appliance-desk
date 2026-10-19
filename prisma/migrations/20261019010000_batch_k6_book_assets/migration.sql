-- K-6 additive book-asset storage and distinct CPA tax evidence.
-- No historical data rewrite or provider access.
CREATE TABLE "BookAsset" (
 "applianceId" TEXT PRIMARY KEY,
 "costCents" INTEGER NOT NULL,
 "placedInServiceOn" TIMESTAMP(3) NOT NULL,
 "lifeMonths" INTEGER NOT NULL,
 "salvagePercent" INTEGER NOT NULL,
 "lastDepreciationMonth" TEXT,
 "retiredOn" TIMESTAMP(3),
 "retirementIntent" TEXT,
 "retiredValueCents" INTEGER,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BookAsset_applianceId_fkey" FOREIGN KEY ("applianceId")
   REFERENCES "Appliance"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
 CONSTRAINT "BookAsset_values_check" CHECK ("costCents" > 0 AND "lifeMonths" BETWEEN 1 AND 360
   AND "salvagePercent" BETWEEN 0 AND 95 AND "version" >= 1),
 CONSTRAINT "BookAsset_month_check" CHECK ("lastDepreciationMonth" IS NULL
   OR "lastDepreciationMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 CONSTRAINT "BookAsset_retirement_check" CHECK (
   ("retiredOn" IS NULL AND "retirementIntent" IS NULL AND "retiredValueCents" IS NULL)
   OR ("retiredOn" IS NOT NULL
     AND "retirementIntent" IN ('SELL','DECIDE_LATER','SCRAP','STRIP','DISPOSE','DONATE_OTHER')
     AND "retiredValueCents" >= 0))
);
CREATE INDEX "BookAsset_retiredOn_idx" ON "BookAsset"("retiredOn");

CREATE TABLE "BookTaxEvidence" (
 "id" TEXT PRIMARY KEY,
 "applianceId" TEXT NOT NULL,
 "classification" TEXT NOT NULL,
 "confidence" TEXT NOT NULL,
 "originalBasisCents" INTEGER,
 "signedAdjustmentsCents" INTEGER,
 "allowedDepreciationCents" INTEGER,
 "section179Cents" INTEGER,
 "bonusDepreciationCents" INTEGER,
 "evidenceAsOf" TIMESTAMP(3) NOT NULL,
 "sourceReference" TEXT NOT NULL,
 "cpaName" TEXT,
 "recordedByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BookTaxEvidence_applianceId_fkey" FOREIGN KEY ("applianceId")
   REFERENCES "BookAsset"("applianceId") ON UPDATE CASCADE ON DELETE RESTRICT,
 CONSTRAINT "BookTaxEvidence_confidence_check"
   CHECK ("confidence" IN ('UNKNOWN','OWNER_SUPPLIED','CPA_CONFIRMED')),
 CONSTRAINT "BookTaxEvidence_classification_check"
   CHECK ("classification" IN ('UNKNOWN','RENTAL_ASSET','EXPENSED','INVENTORY','OTHER')),
 CONSTRAINT "BookTaxEvidence_cents_check" CHECK (
   ("originalBasisCents" IS NULL OR "originalBasisCents" >= 0)
   AND ("allowedDepreciationCents" IS NULL OR "allowedDepreciationCents" >= 0)
   AND ("section179Cents" IS NULL OR "section179Cents" >= 0)
   AND ("bonusDepreciationCents" IS NULL OR "bonusDepreciationCents" >= 0))
);
CREATE INDEX "BookTaxEvidence_applianceId_createdAt_idx" ON "BookTaxEvidence"("applianceId","createdAt");

-- An asset held for disposition retains carrying value; this is not a disposal loss.
INSERT INTO "LedgerAccount"
 ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","createdAt","updatedAt")
VALUES
 ('k6_retired_pending','RETIRED_PENDING_DISPOSITION',
  'Retired appliances held pending sale or supported disposal','ASSET',
  'Preserved rental asset carrying value after removal from rentable service; not a disposal loss',
  FALSE,TRUE,85,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("systemRole") DO NOTHING;
