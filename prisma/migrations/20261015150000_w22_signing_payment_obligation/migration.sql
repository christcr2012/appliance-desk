-- W-22D4: additive immutable signing obligation. This is NOT payment settlement.
CREATE TABLE "AgreementSigningPayment" (
    "agreementId" TEXT NOT NULL,
    "orderFingerprint" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL,
    "setupFeeCents" INTEGER NOT NULL,
    "setupTaxCents" INTEGER NOT NULL,
    "downPaymentCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgreementSigningPayment_pkey" PRIMARY KEY ("agreementId"),
    CONSTRAINT "AgreementSigningPayment_frozen_amounts_check" CHECK (
      "orderFingerprint" ~ '^[0-9a-f]{64}$'
      AND "evidenceVersion" = 1
      AND "setupFeeCents" >= 0 AND "setupTaxCents" >= 0
      AND "downPaymentCents" >= 0 AND "totalCents" >= 0
      AND "totalCents"::BIGINT = "setupFeeCents"::BIGINT + "setupTaxCents"::BIGINT + "downPaymentCents"::BIGINT
      AND (("totalCents" = 0 AND "status" = 'NOT_DUE') OR
           ("totalCents" > 0 AND "status" = 'AWAITING_PAYMENT'))
    )
);
CREATE INDEX "AgreementSigningPayment_status_signedAt_idx" ON "AgreementSigningPayment"("status", "signedAt");
ALTER TABLE "AgreementSigningPayment" ADD CONSTRAINT "AgreementSigningPayment_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
