-- Safe deploy for the tax-rate change. Production runs migrations BEFORE the new
-- version of the app takes over, so for a short time the OLD app can still save a
-- tax rate into the old tenths-of-a-percent column. Without this, that save would
-- leave the new exact column at zero (or stale) and tax could be left off an invoice.
--
-- This keeps the two columns in step in both directions:
--   * old app saves the old column  -> the new exact column follows (x100, exact)
--   * new app saves the new column  -> the old column follows (rounded to the nearest
--                                      tenth, only so a rollback still charges
--                                      about the right tax)
-- Nothing is dropped. A later cleanup batch removes the old column and this trigger
-- together once no old version can run (docs/DECISIONS.md, 2026-10-03).
CREATE OR REPLACE FUNCTION "sync_tax_rate_columns"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."taxRateMilliPercent" = 0 AND NEW."taxRatePermille" <> 0 THEN
      NEW."taxRateMilliPercent" := NEW."taxRatePermille" * 100;
    ELSIF NEW."taxRatePermille" = 0 AND NEW."taxRateMilliPercent" <> 0 THEN
      NEW."taxRatePermille" := round(NEW."taxRateMilliPercent" / 100.0);
    END IF;
  ELSE
    IF NEW."taxRatePermille" IS DISTINCT FROM OLD."taxRatePermille"
       AND NEW."taxRateMilliPercent" IS NOT DISTINCT FROM OLD."taxRateMilliPercent" THEN
      NEW."taxRateMilliPercent" := NEW."taxRatePermille" * 100;
    ELSIF NEW."taxRateMilliPercent" IS DISTINCT FROM OLD."taxRateMilliPercent"
       AND NEW."taxRatePermille" IS NOT DISTINCT FROM OLD."taxRatePermille" THEN
      NEW."taxRatePermille" := round(NEW."taxRateMilliPercent" / 100.0);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RentalAgreement_sync_tax_rate"
  BEFORE INSERT OR UPDATE ON "RentalAgreement"
  FOR EACH ROW EXECUTE FUNCTION "sync_tax_rate_columns"();

CREATE TRIGGER "BusinessSettings_sync_tax_rate"
  BEFORE INSERT OR UPDATE ON "BusinessSettings"
  FOR EACH ROW EXECUTE FUNCTION "sync_tax_rate_columns"();

-- Catch up anything an old version saved between the previous migration and now.
UPDATE "RentalAgreement" SET "taxRateMilliPercent" = "taxRatePermille" * 100
  WHERE "taxRateMilliPercent" = 0 AND "taxRatePermille" <> 0;
UPDATE "BusinessSettings" SET "taxRateMilliPercent" = "taxRatePermille" * 100
  WHERE "taxRateMilliPercent" = 0 AND "taxRatePermille" <> 0;
