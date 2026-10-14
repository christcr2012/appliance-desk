-- Record externally completed refund evidence only; no automated Stripe refund or historical data changes.
ALTER TABLE "PreDeliveryCancellation"
  ADD COLUMN "returnedOn" TIMESTAMP(3),
  ADD COLUMN "returnedRecordedAt" TIMESTAMP(3),
  ADD COLUMN "returnedByUserId" TEXT,
  ADD COLUMN "refundMethod" TEXT,
  ADD COLUMN "refundReference" TEXT,
  ADD COLUMN "returnEvidence" JSONB;
CREATE UNIQUE INDEX "PreDeliveryCancellation_refundReference_key"
  ON "PreDeliveryCancellation"("refundReference");
