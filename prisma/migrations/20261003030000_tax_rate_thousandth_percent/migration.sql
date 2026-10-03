-- Batch B owner decision IN-17 changes the meaning of the existing
-- taxRatePermille columns from tenths of one percentage point to thousandths
-- of one percentage point. Preserve every already-configured effective rate by
-- scaling stored snapshots/settings by 100 exactly once in this migration.
-- Example: 73 (7.3% under the old convention) -> 7300 (7.300%).

UPDATE "BusinessSettings"
SET "taxRatePermille" = "taxRatePermille" * 100;

UPDATE "RentalAgreement"
SET "taxRatePermille" = "taxRatePermille" * 100;
