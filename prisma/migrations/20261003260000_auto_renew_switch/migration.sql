-- Owner master switch for automatic renewals. Starts OFF. Additive only.
ALTER TABLE "BusinessSettings" ADD COLUMN "autoRenewEnabled" BOOLEAN NOT NULL DEFAULT false;
