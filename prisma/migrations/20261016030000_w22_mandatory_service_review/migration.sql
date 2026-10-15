ALTER TABLE "RentalAgreement"
  ADD COLUMN "mandatoryChargeReviewVersions" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Preserve historical reviewed fee/tax/source choices for every address.
CREATE OR REPLACE FUNCTION "w22_guard_mandatory_review_history"()
RETURNS TRIGGER AS $$
DECLARE i INTEGER;
BEGIN
  IF OLD."mandatoryChargeReviewVersions" IS DISTINCT FROM NEW."mandatoryChargeReviewVersions" THEN
    IF OLD."status" <> 'DRAFT' OR NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Cannot rewrite historical non-draft service fee review';
    END IF;
    IF jsonb_typeof(NEW."mandatoryChargeReviewVersions") <> 'array' OR
       jsonb_array_length(NEW."mandatoryChargeReviewVersions") <
       jsonb_array_length(OLD."mandatoryChargeReviewVersions") OR
       jsonb_array_length(NEW."mandatoryChargeReviewVersions") > 256 THEN
      RAISE EXCEPTION 'Mandatory service fee review history has invalid length';
    END IF;
    FOR i IN 0..jsonb_array_length(OLD."mandatoryChargeReviewVersions")-1 LOOP
      IF NEW."mandatoryChargeReviewVersions"->i
         IS DISTINCT FROM OLD."mandatoryChargeReviewVersions"->i THEN
        RAISE EXCEPTION 'Mandatory service fee review history is append only';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "w22_mandatory_review_history_guard"
  BEFORE UPDATE ON "RentalAgreement"
  FOR EACH ROW EXECUTE FUNCTION "w22_guard_mandatory_review_history"();
