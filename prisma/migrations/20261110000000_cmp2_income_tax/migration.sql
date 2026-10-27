-- CMP-2: income tax helpers. Two additive changes:
-- 1. LedgerAccount.scheduleCLine — the Schedule C line each books
--    account's year totals land on. Existing system accounts are filled
--    in from the system chart (the same values in
--    src/domains/books/system-chart.json); owner-added accounts stay
--    null, which the packet reads as line 27a (Other expenses).
ALTER TABLE "LedgerAccount" ADD COLUMN "scheduleCLine" TEXT;

-- 2. TaxYearFacts — per-year figures the owner (or CPA) records about a
--    finished tax year: last year's federal tax and AGI and Colorado tax
--    (the safe-harbor estimates are computed from them) and the 1099-K
--    gross typed from Stripe's form (the tie-out compares against it).
CREATE TABLE "TaxYearFacts" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "federalTaxCents" INTEGER,
    "federalAgiCents" INTEGER,
    "coloradoTaxCents" INTEGER,
    "form1099KGrossCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxYearFacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxYearFacts_year_key" ON "TaxYearFacts"("year");

UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'RENTAL_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'LATE_RETURN_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'DELIVERY_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'INSTALLATION_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'REMOVAL_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'DAMAGE_WAIVER_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'LATE_FEE_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'EARLY_TERMINATION_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'DAMAGE_RECOVERY_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'TAX_SERVICE_FEE_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'MERCHANDISE_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'RETIRED_APPLIANCE_SALES';
UPDATE "LedgerAccount" SET "scheduleCLine" = '1' WHERE "systemRole" = 'SCRAP_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '6' WHERE "systemRole" = 'OTHER_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '6' WHERE "systemRole" = 'INTEREST_INCOME';
UPDATE "LedgerAccount" SET "scheduleCLine" = '2' WHERE "systemRole" = 'DISCOUNTS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '2' WHERE "systemRole" = 'CREDITS_GIVEN';
UPDATE "LedgerAccount" SET "scheduleCLine" = '2' WHERE "systemRole" = 'REFUNDS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '8' WHERE "systemRole" = 'EXPENSE_ADVERTISING_AND_MARKETING';
UPDATE "LedgerAccount" SET "scheduleCLine" = '9' WHERE "systemRole" = 'EXPENSE_FUEL';
UPDATE "LedgerAccount" SET "scheduleCLine" = '9' WHERE "systemRole" = 'EXPENSE_VEHICLE_REPAIRS_AND_MAINTENANCE';
UPDATE "LedgerAccount" SET "scheduleCLine" = '9' WHERE "systemRole" = 'EXPENSE_VEHICLE_INSURANCE';
UPDATE "LedgerAccount" SET "scheduleCLine" = '13' WHERE "systemRole" = 'DEPRECIATION';
UPDATE "LedgerAccount" SET "scheduleCLine" = '15' WHERE "systemRole" = 'EXPENSE_BUSINESS_INSURANCE';
UPDATE "LedgerAccount" SET "scheduleCLine" = '17' WHERE "systemRole" = 'EXPENSE_PROFESSIONAL_FEES__CPA__LEGAL';
UPDATE "LedgerAccount" SET "scheduleCLine" = '18' WHERE "systemRole" = 'EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '20b' WHERE "systemRole" = 'EXPENSE_STORAGE___WAREHOUSE_RENT';
UPDATE "LedgerAccount" SET "scheduleCLine" = '21' WHERE "systemRole" = 'REPAIRS_PARTS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '22' WHERE "systemRole" = 'EXPENSE_SUPPLIES';
UPDATE "LedgerAccount" SET "scheduleCLine" = '22' WHERE "systemRole" = 'EXPENSE_SMALL_TOOLS_AND_EQUIPMENT';
UPDATE "LedgerAccount" SET "scheduleCLine" = '23' WHERE "systemRole" = 'EXPENSE_LICENSES_AND_PERMITS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '23' WHERE "systemRole" = 'USE_TAX_EXPENSE';
UPDATE "LedgerAccount" SET "scheduleCLine" = '25' WHERE "systemRole" = 'EXPENSE_PHONE_AND_INTERNET';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'CARD_FEES';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'STRIPE_SERVICE_FEES';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'CHARGEBACKS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'BAD_DEBT';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'DISPOSAL_LOSS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'BOOK_VALUE_OF_APPLIANCES_SOLD';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'TAX_ADJUSTMENTS';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'TAX_ABSORBED';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'EXPENSE_BANK_FEES';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'EXPENSE_OTHER';
UPDATE "LedgerAccount" SET "scheduleCLine" = '27a' WHERE "systemRole" = 'EXPENSE_DUMP_AND_DISPOSAL_FEES';
