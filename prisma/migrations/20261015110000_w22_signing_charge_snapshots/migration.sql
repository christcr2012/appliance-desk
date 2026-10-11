CREATE TABLE "AgreementSigningCharge" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "serviceAddressId" TEXT NOT NULL,
  "sourceEstimateId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "machineCount" INTEGER NOT NULL,
  "firstMonthRentCents" INTEGER NOT NULL,
  "setupFeeCents" INTEGER NOT NULL,
  "downPaymentCents" INTEGER NOT NULL,
  "signingSubtotalCents" INTEGER NOT NULL,
  "setupFeeTaxTreatment" TEXT NOT NULL,
  "settingsUpdatedAt" TIMESTAMP(3) NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "frozenAt" TIMESTAMP(3),
  CONSTRAINT "AgreementSigningCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgreementSigningCharge_agreementId_fkey" FOREIGN KEY ("agreementId")
    REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgreementSigningCharge_nonnegative" CHECK (
    "version" >= 1 AND "machineCount" >= 1
    AND "firstMonthRentCents" >= 0 AND "setupFeeCents" >= 0
    AND "downPaymentCents" >= 0
    AND "signingSubtotalCents" = "setupFeeCents" + "downPaymentCents"
  ),
  CONSTRAINT "AgreementSigningCharge_tax_policy" CHECK (
    "setupFeeTaxTreatment" IN ('UNDECIDED','TAXABLE','NOT_TAXABLE')
  ),
  CONSTRAINT "AgreementSigningCharge_sourceFingerprint_format"
    CHECK (length("sourceFingerprint") = 64)
);
CREATE UNIQUE INDEX "AgreementSigningCharge_agreementId_key"
  ON "AgreementSigningCharge"("agreementId");
CREATE INDEX "AgreementSigningCharge_sourceEstimateId_serviceAddressId_idx"
  ON "AgreementSigningCharge"("sourceEstimateId","serviceAddressId");
