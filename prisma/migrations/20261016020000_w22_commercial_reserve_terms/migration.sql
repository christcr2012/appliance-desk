-- Add-only historical commercial reserve policy source; not a new money ledger.
ALTER TABLE "RentalAgreement" ADD COLUMN "commercialReservePolicyVersions" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Once an agreement leaves DRAFT, the original reserve history is unchangeable.
-- This also guards writes outside the TypeScript owner action.
CREATE OR REPLACE FUNCTION "w22_guard_commercial_reserve_terms"()
RETURNS TRIGGER AS $$
DECLARE i INTEGER;
BEGIN
  IF (OLD."status" <> 'DRAFT' OR NEW."status" <> 'DRAFT') AND (
     OLD."depositCents" IS DISTINCT FROM NEW."depositCents" OR
     OLD."commercialReservePolicyVersions" IS DISTINCT FROM NEW."commercialReservePolicyVersions") THEN
    RAISE EXCEPTION 'Historical signed or sent commercial reserve terms cannot be rewritten';
  END IF;
  IF OLD."commercialReservePolicyVersions" IS DISTINCT FROM NEW."commercialReservePolicyVersions" THEN
    IF jsonb_typeof(NEW."commercialReservePolicyVersions") <> 'array' OR
       jsonb_array_length(NEW."commercialReservePolicyVersions") <
       jsonb_array_length(OLD."commercialReservePolicyVersions") OR
       jsonb_array_length(NEW."commercialReservePolicyVersions") > 256 THEN
       RAISE EXCEPTION 'Reserve policy history has invalid length';
    END IF;
    FOR i IN 0..jsonb_array_length(OLD."commercialReservePolicyVersions")-1 LOOP
      IF NEW."commercialReservePolicyVersions"->i
         IS DISTINCT FROM OLD."commercialReservePolicyVersions"->i THEN
        RAISE EXCEPTION 'Reserve policy revisions must preserve every historical entry';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "w22_commercial_reserve_history_guard"
  BEFORE UPDATE ON "RentalAgreement"
  FOR EACH ROW EXECUTE FUNCTION "w22_guard_commercial_reserve_terms"();
