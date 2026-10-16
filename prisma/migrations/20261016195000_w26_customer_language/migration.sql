-- Additive W-26 preference. Existing customer communication remains English.
ALTER TABLE "Customer" ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_preferredLanguage_check" CHECK ("preferredLanguage" IN ('en', 'es'));

ALTER TABLE "SignatureRecord" ADD COLUMN "shownLanguage" TEXT;
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_shownLanguage_check" CHECK ("shownLanguage" IS NULL OR "shownLanguage" IN ('en', 'es'));
