-- Prepaid-term discount (Chris's explicit request — see docs/DECISIONS.md
-- for the dated design decision and docs/BUSINESS-RULES.md's Pricing
-- section for the full rule):
--
-- 1. BusinessSettings gets four independent, owner-adjustable discount
--    amounts (6-month/12-month × set/single unit) plus a toggle for the
--    separate "first month free" bonus. Defaults match the figures Chris
--    gave as a starting point ($5/$2.50 for 6 months, $10/$5 for 12).
--
-- 2. RentalAgreement gets paidInFullInAdvance (Chris records this himself
--    at creation — there's no automated billing yet to detect a real
--    lump-sum payment) and freeMonthGranted (a snapshot of whether the
--    bonus applied, frozen at creation so a later settings change can
--    never retroactively affect an already-signed agreement).
--
-- 3. RentalLine gets listPriceCents (what Chris typed in before any
--    discount) and prepayDiscountCentsPerMonth (what got subtracted).
--    monthlyPriceCents keeps its existing meaning (the actual amount
--    charged) unchanged, so every existing consumer of that column needs
--    no changes. Existing rows never had a discount, so their
--    listPriceCents backfills to their current monthlyPriceCents.

ALTER TABLE "BusinessSettings" ADD COLUMN "sixMonthPrepayDiscountSetCents" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "BusinessSettings" ADD COLUMN "sixMonthPrepayDiscountSingleCents" INTEGER NOT NULL DEFAULT 250;
ALTER TABLE "BusinessSettings" ADD COLUMN "twelveMonthPrepayDiscountSetCents" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "BusinessSettings" ADD COLUMN "twelveMonthPrepayDiscountSingleCents" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "BusinessSettings" ADD COLUMN "twelveMonthPrepayFreeMonthEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "RentalAgreement" ADD COLUMN "paidInFullInAdvance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RentalAgreement" ADD COLUMN "freeMonthGranted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RentalLine" ADD COLUMN "listPriceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RentalLine" ADD COLUMN "prepayDiscountCentsPerMonth" INTEGER NOT NULL DEFAULT 0;

-- Backfill: every existing line was priced with no discount concept at
-- all, so its "list" price is simply whatever it's already charging.
UPDATE "RentalLine" SET "listPriceCents" = "monthlyPriceCents" WHERE "listPriceCents" = 0;
