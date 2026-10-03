-- Owner's master switch for emails to customers. Starts OFF. Additive only.
ALTER TABLE "BusinessSettings" ADD COLUMN "customerEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
