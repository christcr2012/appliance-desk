CREATE TABLE "SigningBusinessReview" (
 "id" TEXT PRIMARY KEY, "agreementId" TEXT NOT NULL REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT,
 "revision" INTEGER NOT NULL CHECK ("revision">0),
 "orderFingerprint" TEXT NOT NULL CHECK ("orderFingerprint" ~ '^[0-9a-f]{64}$'),
 "decision" TEXT NOT NULL CHECK ("decision" IN ('APPROVED','REVIEW_REQUIRED')),
 "effectiveFromKey" TEXT NOT NULL CHECK ("effectiveFromKey" ~ '^\d{4}-\d{2}-\d{2}$'),
 "confirmedOnKey" TEXT NOT NULL CHECK ("confirmedOnKey" ~ '^\d{4}-\d{2}-\d{2}$'),
 "taxAdviserReference" TEXT NOT NULL CHECK(length(trim("taxAdviserReference")) BETWEEN 12 AND 500),
 "legalAdviserReference" TEXT NOT NULL CHECK(length(trim("legalAdviserReference")) BETWEEN 12 AND 500),
 "termsReference" TEXT NOT NULL CHECK(length(trim("termsReference")) BETWEEN 12 AND 500),
 "reason" TEXT NOT NULL CHECK(length(trim("reason")) BETWEEN 12 AND 500),
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SigningBusinessReview_agreementId_revision_key" ON "SigningBusinessReview"("agreementId","revision");
CREATE INDEX "SigningBusinessReview_agreementId_effectiveFromKey_recordedAt_idx" ON "SigningBusinessReview"("agreementId","effectiveFromKey","recordedAt");
CREATE FUNCTION "w22_business_review_immutable"() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Professional review history is immutable; append an owner-reviewed revision'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "w22_business_review_immutable" BEFORE UPDATE OR DELETE ON "SigningBusinessReview"
FOR EACH ROW EXECUTE FUNCTION "w22_business_review_immutable"();
-- Raw SQL cannot substitute a staff actor or another agreement's frozen hash.
CREATE FUNCTION "w22_business_review_source"() RETURNS TRIGGER AS $$
DECLARE previous INTEGER;
BEGIN
 PERFORM 1 FROM "RentalAgreement" WHERE "id"=NEW."agreementId" FOR UPDATE;
 SELECT COALESCE(MAX("revision"),0) INTO previous FROM "SigningBusinessReview" WHERE "agreementId"=NEW."agreementId";
 IF NEW."revision"<>previous+1 OR NOT EXISTS (
   SELECT 1 FROM "User" WHERE "id"=NEW."actorUserId" AND "role"='OWNER' AND "archivedAt" IS NULL
 ) OR NOT EXISTS (
   SELECT 1 FROM "AgreementSigningCharge" WHERE "agreementId"=NEW."agreementId"
     AND "frozenOrderFingerprint"=NEW."orderFingerprint" AND "frozenAt" IS NOT NULL
     AND "frozenChargeEvidence"->>'schemaVersion'='2'
 ) THEN RAISE EXCEPTION 'Owner review requires the exact frozen order and next immutable revision'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "w22_business_review_source" BEFORE INSERT ON "SigningBusinessReview"
FOR EACH ROW EXECUTE FUNCTION "w22_business_review_source"();
