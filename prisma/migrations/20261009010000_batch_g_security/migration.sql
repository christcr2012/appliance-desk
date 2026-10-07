-- Batch G: closure evidence + Better Auth two-factor schema foundation.
ALTER TABLE "RentalAgreement" ADD COLUMN "closedAt" TIMESTAMP(3);

UPDATE "RentalAgreement"
SET "closedAt" = COALESCE("endDate", "updatedAt")
WHERE "status" IN ('ENDED', 'CANCELLED')
  AND "closedAt" IS NULL;

ALTER TABLE "BusinessSettings"
  ADD COLUMN "twoFactorRequiredRoles" JSONB NOT NULL DEFAULT '["OWNER","ADMIN"]';

ALTER TABLE "User"
  ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TwoFactor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),

  CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor"("userId");

ALTER TABLE "TwoFactor"
  ADD CONSTRAINT "TwoFactor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
