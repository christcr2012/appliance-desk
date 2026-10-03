-- Sales-tax rates are now stored exactly, in thousandths of one percent
-- (7.375% = 7375), so rates such as 7.375% are not rounded (owner decision
-- IN-17). Additive: the old tenths-of-a-percent columns are left in place,
-- unused, and are copied across exactly (73 tenths = 7300 thousandths).
ALTER TABLE "RentalAgreement" ADD COLUMN "taxRateMilliPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD COLUMN "taxRateMilliPercent" INTEGER NOT NULL DEFAULT 0;
UPDATE "RentalAgreement" SET "taxRateMilliPercent" = "taxRatePermille" * 100;
UPDATE "BusinessSettings" SET "taxRateMilliPercent" = "taxRatePermille" * 100;
