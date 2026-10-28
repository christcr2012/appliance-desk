-- FEETAX-1 (Lane 5): the haul-away service price. Additive; 0 = not
-- priced yet, so existing rows and reads keep their meaning.
ALTER TABLE "BusinessSettings" ADD COLUMN "oneTimeHaulAwayFeeCents" INTEGER NOT NULL DEFAULT 0;
