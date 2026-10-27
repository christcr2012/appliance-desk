-- TFA-2 §8: filing-frequency advice (TAX-FEE-AUTOPILOT section 8).
-- The monthly job compares the trailing-12-month average of state and
-- state-collected tax with the rule-book filing-frequency limits and records
-- an advice row. The app never changes the filing frequency itself; the
-- owner asks Colorado in Revenue Online, then confirms on Today, which sets
-- the account frequency for future periods and marks the advice confirmed.
-- Additive only: one new table.

-- CreateTable
CREATE TABLE "FilingFrequencyAdvice" (
    "id" TEXT NOT NULL,
    "filingAccountId" TEXT NOT NULL,
    "currentFrequency" "TaxFilingFrequency" NOT NULL,
    "advisedFrequency" "TaxFilingFrequency" NOT NULL,
    "averageMonthlyCents" INTEGER NOT NULL,
    "computedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,

    CONSTRAINT "FilingFrequencyAdvice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilingFrequencyAdvice_filingAccountId_computedOn_idx" ON "FilingFrequencyAdvice"("filingAccountId", "computedOn");

-- AddForeignKey
ALTER TABLE "FilingFrequencyAdvice" ADD CONSTRAINT "FilingFrequencyAdvice_filingAccountId_fkey" FOREIGN KEY ("filingAccountId") REFERENCES "TaxFilingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
