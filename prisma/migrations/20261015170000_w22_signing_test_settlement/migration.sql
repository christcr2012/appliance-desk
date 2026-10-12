-- Verified W-22 TEST payment receipts, never checkout redirects or assumed credits.
ALTER TABLE "AgreementSigningPayment"
 ADD COLUMN "receiptId" TEXT,
 ADD COLUMN "settledAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "AgreementSigningPayment_receiptId_key"
 ON "AgreementSigningPayment"("receiptId");
ALTER TABLE "AgreementSigningPayment" ADD CONSTRAINT "AgreementSigningPayment_receiptId_fkey"
 FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgreementSigningPayment"
 DROP CONSTRAINT "AgreementSigningPayment_frozen_amounts_check";
ALTER TABLE "AgreementSigningPayment"
 ADD CONSTRAINT "AgreementSigningPayment_frozen_amounts_check" CHECK (
   "orderFingerprint" ~ '^[0-9a-f]{64}$'
   AND "evidenceVersion" = 1
   AND "setupFeeCents" >= 0 AND "setupTaxCents" >= 0
   AND "downPaymentCents" >= 0 AND "totalCents" >= 0
   AND "totalCents"::BIGINT = "setupFeeCents"::BIGINT + "setupTaxCents"::BIGINT + "downPaymentCents"::BIGINT
   AND (
     ("totalCents" = 0 AND "status" = 'NOT_DUE'
       AND "receiptId" IS NULL AND "settledAt" IS NULL)
     OR
     ("totalCents" > 0 AND "status" = 'AWAITING_PAYMENT'
       AND "receiptId" IS NULL AND "settledAt" IS NULL)
     OR
     ("totalCents" > 0 AND "status" = 'SETTLED'
       AND "receiptId" IS NOT NULL AND "settledAt" IS NOT NULL)
   )
 );
ALTER TABLE "SigningPaymentAttempt" ADD COLUMN "stripePaymentIntentId" TEXT;
CREATE UNIQUE INDEX "SigningPaymentAttempt_stripePaymentIntentId_key"
 ON "SigningPaymentAttempt"("stripePaymentIntentId");
