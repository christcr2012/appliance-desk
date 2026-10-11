-- W-22A settings only; payment collection remains separately gated.
ALTER TABLE "BusinessSettings"
ADD COLUMN "administrativeSetupFeeCents" INTEGER NOT NULL DEFAULT 4500,
ADD COLUMN "largeOrderMachineThreshold" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "businessRequiresDownPayment" BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN "setupFeeTaxTreatment" TEXT NOT NULL DEFAULT 'UNDECIDED',
ADD COLUMN "setupFeeTaxDecisionNote" TEXT;
