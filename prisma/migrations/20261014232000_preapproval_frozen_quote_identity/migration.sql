ALTER TABLE "Estimate"
  ADD COLUMN "reviewedQuoteFingerprint" TEXT,
  ADD COLUMN "reviewedOrderFingerprint" TEXT,
  ADD COLUMN "reviewedQuoteAt" TIMESTAMP(3);
