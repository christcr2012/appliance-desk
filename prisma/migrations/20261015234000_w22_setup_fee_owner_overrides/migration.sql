-- Additive audit-backed per-order/location setup-fee adjustment.
CREATE TABLE "SigningSetupFeeOverride" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "setupFeeCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "authorizedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SigningSetupFeeOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SigningSetupFeeOverride_agreementId_key" ON "SigningSetupFeeOverride"("agreementId");
ALTER TABLE "SigningSetupFeeOverride" ADD CONSTRAINT "SigningSetupFeeOverride_agreementId_fkey"
 FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
