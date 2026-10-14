-- Review/obligation only: no Stripe refunds and no existing agreement mutation.
ALTER TABLE "BusinessSettings"
  ADD COLUMN "largeOrderCancellationFullRefundHours" INTEGER NOT NULL DEFAULT 72;

CREATE TABLE "PreDeliveryCancellation" (
  "agreementId" TEXT NOT NULL,
  "receiptId" TEXT,
  "orderFingerprint" TEXT,
  "policy" TEXT NOT NULL,
  "signedAmountCents" INTEGER NOT NULL,
  "refundDueCents" INTEGER NOT NULL,
  "retainedCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewedTerms" BOOLEAN NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refundState" TEXT NOT NULL,
  CONSTRAINT "PreDeliveryCancellation_pkey" PRIMARY KEY ("agreementId")
);
CREATE INDEX "PreDeliveryCancellation_refundState_approvedAt_idx"
 ON "PreDeliveryCancellation"("refundState","approvedAt");
ALTER TABLE "PreDeliveryCancellation"
 ADD CONSTRAINT "PreDeliveryCancellation_agreementId_fkey"
 FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
