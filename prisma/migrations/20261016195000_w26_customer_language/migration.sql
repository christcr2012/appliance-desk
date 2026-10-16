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
