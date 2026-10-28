-- TAXBEN-1: the owner's capitalization preference (bonus depreciation by
-- default, or Section 179 when the CPA prefers it — DQ-TAXBEN-179-VS-BONUS).
-- Additive, with the spec's starting value as the column default.

ALTER TABLE "BusinessSettings"
    ADD COLUMN "capitalizationPreference" TEXT NOT NULL DEFAULT 'BONUS';
