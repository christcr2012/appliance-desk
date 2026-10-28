-- AR-4a: why a rental ended (optional capture at the end paths' confirm step)
-- plus the owner's editable list of end reasons. Additive only.
ALTER TABLE "RentalAgreement" ADD COLUMN "endReason" TEXT;
ALTER TABLE "RentalAgreement" ADD COLUMN "endReasonNote" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "rentalEndReasons" JSONB NOT NULL DEFAULT '["Moving away","Bought their own","Price","Not happy with the service","Didn''t need it anymore","Property sold or tenant left"]';
