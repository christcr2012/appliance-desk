-- A prepared attempt is a reservation, never a receipt or bill credit.
CREATE TABLE "SigningPaymentAttempt" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "orderFingerprint" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "providerObjectId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SigningPaymentAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SigningPaymentAttempt_amount_check" CHECK ("amountCents" > 0 AND "amountCents" <= 2147483647),
    CONSTRAINT "SigningPaymentAttempt_number_check" CHECK ("attemptNumber" > 0),
    CONSTRAINT "SigningPaymentAttempt_fingerprint_check" CHECK (length("orderFingerprint") = 64 AND "orderFingerprint" ~ '^[a-f0-9]+$'),
    CONSTRAINT "SigningPaymentAttempt_method_check" CHECK ("method" IN ('STRIPE_CHECKOUT', 'MANUAL')),
    CONSTRAINT "SigningPaymentAttempt_status_check" CHECK ("status" IN ('PREPARED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "SigningPaymentAttempt_requestKey_key" ON "SigningPaymentAttempt"("requestKey");
CREATE UNIQUE INDEX "SigningPaymentAttempt_providerObjectId_key" ON "SigningPaymentAttempt"("providerObjectId");
CREATE UNIQUE INDEX "SigningPaymentAttempt_agreementId_attemptNumber_key" ON "SigningPaymentAttempt"("agreementId", "attemptNumber");
CREATE INDEX "SigningPaymentAttempt_agreementId_status_idx" ON "SigningPaymentAttempt"("agreementId", "status");
ALTER TABLE "SigningPaymentAttempt" ADD CONSTRAINT "SigningPaymentAttempt_agreementId_fkey"
FOREIGN KEY ("agreementId") REFERENCES "AgreementSigningPayment"("agreementId")
ON DELETE RESTRICT ON UPDATE CASCADE;
