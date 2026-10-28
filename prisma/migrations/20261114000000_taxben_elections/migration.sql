-- TAXBEN-2: the per-year bonus depreciation elect-out choice (property class
-- keys from the us.class_life_months rule). Additive and nullable: no choice
-- recorded means no election, exactly as before this card.

ALTER TABLE "TaxYearFacts"
    ADD COLUMN "bonusElectOutClasses" JSONB;
