-- Additive W-26 preference. Existing customer communication remains English.
ALTER TABLE "Customer" ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_preferredLanguage_check" CHECK ("preferredLanguage" IN ('en', 'es'));

ALTER TABLE "SignatureRecord" ADD COLUMN "shownLanguage" TEXT;
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_shownLanguage_check" CHECK ("shownLanguage" IS NULL OR "shownLanguage" IN ('en', 'es'));

CREATE TABLE "CustomerLanguageReview" (
  "language" TEXT NOT NULL PRIMARY KEY,
  "copyDigest" TEXT NOT NULL,
  "reviewerName" TEXT NOT NULL,
  "reviewReference" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "legalReviewerName" TEXT,
  "legalReviewReference" TEXT,
  "legalReviewedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "publishedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "CustomerLanguageReviewEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "language" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reviewedDigest" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerLanguageReviewEvent_language_fkey"
    FOREIGN KEY ("language") REFERENCES "CustomerLanguageReview"("language") ON DELETE RESTRICT
);
CREATE INDEX "CustomerLanguageReviewEvent_language_occurredAt_idx"
  ON "CustomerLanguageReviewEvent"("language", "occurredAt");

ALTER TABLE "Estimate" ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_preferredLanguage_check" CHECK ("preferredLanguage" IN ('en', 'es'));

CREATE TABLE "CustomerTranslationDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceKind" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "englishDigest" TEXT NOT NULL,
  "spanishText" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "editedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CustomerTranslationDraft_sourceKind_sourceKey_key"
  ON "CustomerTranslationDraft"("sourceKind", "sourceKey");

-- Additional evidence belongs to this unpublished W-26 additive migration.
ALTER TABLE "SignatureRecord" ADD COLUMN "interfaceLanguage" TEXT;
ALTER TABLE "SignatureRecord" ADD COLUMN "translationCopyDigest" TEXT;
ALTER TABLE "SignatureRecord" ADD COLUMN "informationalTerms" JSONB;
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_interfaceLanguage_check"
  CHECK ("interfaceLanguage" IS NULL OR "interfaceLanguage" IN ('en', 'es'));
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_translationCopyDigest_check"
  CHECK ("translationCopyDigest" IS NULL OR "translationCopyDigest" ~ '^[a-f0-9]{64}$');
CREATE FUNCTION "w26_protect_signed_language"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."signedAt" IS NOT NULL AND (
    OLD."shownLanguage" IS DISTINCT FROM NEW."shownLanguage" OR
    OLD."interfaceLanguage" IS DISTINCT FROM NEW."interfaceLanguage" OR
    OLD."translationCopyDigest" IS DISTINCT FROM NEW."translationCopyDigest" OR
    OLD."informationalTerms" IS DISTINCT FROM NEW."informationalTerms"
  ) THEN
    RAISE EXCEPTION 'Historical signed language evidence cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "w26_protect_signed_language" BEFORE UPDATE ON "SignatureRecord"
FOR EACH ROW EXECUTE FUNCTION "w26_protect_signed_language"();

-- Existing notices retain their exact recorded English wording.
ALTER TABLE "CustomerNotice" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "CustomerNotice" ADD COLUMN "translationCopyDigest" TEXT;
ALTER TABLE "CustomerNotice" ADD CONSTRAINT "CustomerNotice_language_check" CHECK ("language" IN ('en','es'));

ALTER TABLE "MessageDelivery" ADD COLUMN "contentLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "MessageDelivery" ADD COLUMN "translationCopyDigest" TEXT;
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_contentLanguage_check" CHECK ("contentLanguage" IN ('en','es'));

-- Existing provider attempts retain omitted locale; only new attempts freeze it.
ALTER TABLE "SigningPaymentAttempt" ADD COLUMN "checkoutLocale" TEXT;
ALTER TABLE "SigningPaymentAttempt" ADD CONSTRAINT "SigningPaymentAttempt_checkoutLocale_check"
 CHECK ("checkoutLocale" IS NULL OR "checkoutLocale" IN ('en', 'es'));
