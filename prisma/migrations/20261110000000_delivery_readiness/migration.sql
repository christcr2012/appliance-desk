-- FEETAX-2: delivery-area tax readiness. New JurisdictionReadiness and
-- JurisdictionDeliveryCount tables, the owner's one-order readiness
-- override fields on RentalAgreement, and the seeded catalogue of the
-- incorporated places in docs/research/2026-10-25-tax-jurisdictions-50mi.md.
-- Additive only. No tax RATES are seeded: rates keep coming from
-- TaxRateVersion (DR 1002 / GIS / manual); the research table's rates are
-- Medium confidence and are never written as facts.

CREATE TYPE "LicenseRequirement" AS ENUM ('NONE', 'AFTER_FIRST_DELIVERY', 'AFTER_SECOND_DELIVERY_IN_12_MONTHS', 'ALWAYS', 'UNKNOWN');

CREATE TYPE "FilingChannel" AS ENUM ('SUTS', 'CITY_PORTAL', 'STATE_RETURN', 'UNKNOWN');

CREATE TABLE "JurisdictionReadiness" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "licenseRequired" "LicenseRequirement" NOT NULL DEFAULT 'UNKNOWN',
    "licenseRecordId" TEXT,
    "filesThrough" "FilingChannel" NOT NULL DEFAULT 'UNKNOWN',
    "sourceUrl" VARCHAR(500),
    "checkedOn" TIMESTAMP(3),
    "reviewStatus" "TaxReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JurisdictionReadiness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JurisdictionReadiness_jurisdictionId_key"
    ON "JurisdictionReadiness"("jurisdictionId");

ALTER TABLE "JurisdictionReadiness"
    ADD CONSTRAINT "JurisdictionReadiness_jurisdictionId_fkey"
    FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JurisdictionReadiness"
    ADD CONSTRAINT "JurisdictionReadiness_licenseRecordId_fkey"
    FOREIGN KEY ("licenseRecordId") REFERENCES "BusinessPaperwork"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JurisdictionDeliveryCount" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "deliveredOn" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "JurisdictionDeliveryCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JurisdictionDeliveryCount_orderId_key"
    ON "JurisdictionDeliveryCount"("orderId");

CREATE INDEX "JurisdictionDeliveryCount_jurisdictionId_deliveredOn_idx"
    ON "JurisdictionDeliveryCount"("jurisdictionId", "deliveredOn");

ALTER TABLE "JurisdictionDeliveryCount"
    ADD CONSTRAINT "JurisdictionDeliveryCount_jurisdictionId_fkey"
    FOREIGN KEY ("jurisdictionId") REFERENCES "TaxJurisdiction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RentalAgreement"
    ADD COLUMN "readinessOverrideByUserId" TEXT,
    ADD COLUMN "readinessOverrideReason" VARCHAR(500),
    ADD COLUMN "readinessOverrideAt" TIMESTAMP(3);

-- The catalogue: one jurisdiction + readiness row per incorporated place.
-- The jurisdiction's own reviewStatus (the rate-review flag) stays
-- NEEDS_REVIEW; readiness reviewStatus is the FEETAX-2 research review.


INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-garden-city', 'GARDEN-CITY', 'Garden City', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-garden-city', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'GARDEN-CITY'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-greeley', 'GREELEY', 'Greeley', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-greeley', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Home-rule home base: city return covers rentals (Medium - CPA/Greeley to confirm in writing); city license required.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'GREELEY'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-evans', 'EVANS', 'Evans', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-evans', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent taxed - ''leases or rentals of items delivered to Evans'' (High); license presumed (unconfirmed).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'EVANS'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-la-salle', 'LA-SALLE', 'La Salle', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-la-salle', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LA-SALLE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-eaton', 'EATON', 'Eaton', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-eaton', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'EATON'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-kersey', 'KERSEY', 'Kersey', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-kersey', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'KERSEY'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-milliken', 'MILLIKEN', 'Milliken', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-milliken', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'MILLIKEN'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-severance', 'SEVERANCE', 'Severance', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-severance', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'SEVERANCE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-gilcrest', 'GILCREST', 'Gilcrest', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-gilcrest', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'GILCREST'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-windsor', 'WINDSOR', 'Windsor', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-windsor', j."id", 'AFTER_SECOND_DELIVERY_IN_12_MONTHS', 'SUTS', 'https://www.windsorco.gov/717/Sales-Tax', '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; any business making taxable sales needs a Windsor account (MUNIRevs, no fee without physical presence); more than one delivery in 12 months = engaged in business (High).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WINDSOR'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-ault', 'AULT', 'Ault', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-ault', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'AULT'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-johnstown', 'JOHNSTOWN', 'Johnstown', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-johnstown', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license. Public improvement fee areas exist.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'JOHNSTOWN'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-pierce', 'PIERCE', 'Pierce', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-pierce', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'PIERCE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-platteville', 'PLATTEVILLE', 'Platteville', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-platteville', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'PLATTEVILLE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-timnath', 'TIMNATH', 'Timnath', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-timnath', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'TIMNATH'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-loveland', 'LOVELAND', 'Loveland', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-loveland', j."id", 'ALWAYS', 'SUTS', 'https://lovgov.org/services/finance/sales-tax/frequently-asked-questions', '2026-10-25T00:00:00.000Z', 'REVIEWED', 'Rent taxed - ''leases of tangible personal property'' (High); license required - making a delivery into the city; SUTS filing does not replace the license (High).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LOVELAND'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-nunn', 'NUNN', 'Nunn', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-nunn', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'NUNN'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-mead', 'MEAD', 'Mead', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-mead', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'MEAD'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-berthoud', 'BERTHOUD', 'Berthoud', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-berthoud', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BERTHOUD'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-fort-collins', 'FORT-COLLINS', 'Fort Collins', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-fort-collins', j."id", 'AFTER_SECOND_DELIVERY_IN_12_MONTHS', 'SUTS', 'https://www.fortcollins.gov/files/sharedassets/city/v/1/financial-services/sales-tax/rules-and-regulations-documents/transportation_delivery.pdf', '2026-10-25T00:00:00.000Z', 'REVIEWED', 'Rent taxed (High); license after more than one non-common-carrier delivery in 12 months or renting property in the city (High). Delivery taxable even if separately stated.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FORT-COLLINS'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-keenesburg', 'KEENESBURG', 'Keenesburg', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-keenesburg', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'KEENESBURG'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-fort-lupton', 'FORT-LUPTON', 'Fort Lupton', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-fort-lupton', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FORT-LUPTON'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-hudson', 'HUDSON', 'Hudson', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-hudson', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'HUDSON'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-firestone', 'FIRESTONE', 'Firestone', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-firestone', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license. Public improvement fee areas exist.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FIRESTONE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-wellington', 'WELLINGTON', 'Wellington', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-wellington', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WELLINGTON'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-frederick', 'FREDERICK', 'Frederick', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-frederick', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FREDERICK'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-dacono', 'DACONO', 'Dacono', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-dacono', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'DACONO'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-longmont', 'LONGMONT', 'Longmont', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-longmont', j."id", 'ALWAYS', 'SUTS', 'https://longmontcolorado.gov/sales-and-use-tax-1/', '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license required - anyone coming into the city engaging in business, including delivering (High); files through SUTS + MUNIRevs.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LONGMONT'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-lochbuie', 'LOCHBUIE', 'Lochbuie', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-lochbuie', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LOCHBUIE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-brighton', 'BRIGHTON', 'Brighton', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-brighton', j."id", 'ALWAYS', 'CITY_PORTAL', 'https://brightonco.gov/247/Sales-Tax', '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license required if employees come into the city (High); not in SUTS.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BRIGHTON'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-erie', 'ERIE', 'Erie', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-erie', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'ERIE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-thornton', 'THORNTON', 'Thornton', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-thornton', j."id", 'ALWAYS', 'SUTS', 'https://www.thorntonco.gov/media/file/thornton-tax-regulations', '2026-10-25T00:00:00.000Z', 'REVIEWED', 'Rent taxed - property bought only to rent out is taxed on the rentals (High); license required - delivery vehicles or rented equipment in the city; free license (High). Delivery taxable; separately stated installation exempt.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'THORNTON'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-lyons', 'LYONS', 'Lyons', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-lyons', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LYONS'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-commerce-city', 'COMMERCE-CITY', 'Commerce City', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-commerce-city', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'COMMERCE-CITY'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-lafayette', 'LAFAYETTE', 'Lafayette', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-lafayette', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LAFAYETTE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-wiggins', 'WIGGINS', 'Wiggins', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-wiggins', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WIGGINS'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-aurora', 'AURORA', 'Aurora', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-aurora', j."id", 'ALWAYS', 'CITY_PORTAL', 'https://www.auroragov.org//Userfiles/DBFiles/server_1881137/202210/19005912/freight_delivery_and_transportation.pdf', '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed; not in SUTS. Delivery taxable even when separately stated (High).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'AURORA'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-louisville', 'LOUISVILLE', 'Louisville', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-louisville', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LOUISVILLE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-westminster', 'WESTMINSTER', 'Westminster', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-westminster', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed. Delivery taxable even when separately stated (High).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WESTMINSTER'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-denver', 'DENVER', 'Denver', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-denver', j."id", 'ALWAYS', 'CITY_PORTAL', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'Rent taxed - ''leases, or rentals'' (High); retailer''s use tax license required if leasing property located in Denver (High); files on its own eBiz, not SUTS.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'DENVER'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-northglenn', 'NORTHGLENN', 'Northglenn', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-northglenn', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'NORTHGLENN'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-broomfield', 'BROOMFIELD', 'Broomfield', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-broomfield', j."id", 'AFTER_SECOND_DELIVERY_IN_12_MONTHS', 'CITY_PORTAL', 'https://broomfield.org/DocumentCenter/View/25988', '2026-10-25T00:00:00.000Z', 'REVIEWED', 'Rent taxed - rentals of 3 years or less are taxable (High); license after more than one delivery in 12 months or property located there (High); not in SUTS. Delivery is part of the taxable price.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BROOMFIELD'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-superior', 'SUPERIOR', 'Superior', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-superior', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'SUPERIOR'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-boulder', 'BOULDER', 'Boulder', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-boulder', j."id", 'ALWAYS', 'CITY_PORTAL', 'https://bouldercolorado.gov/tax-compliance-guides', '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent likely taxed (Medium - CPA to confirm, DQ-FEETAX2-1); license presumed; not in SUTS. Delivery taxable (High).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BOULDER'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-jamestown', 'JAMESTOWN', 'Jamestown', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-jamestown', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'State-collected but not in the DR 1002 table the research read; values are the state-collected starting values, marked needs review.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'JAMESTOWN'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-federal-heights', 'FEDERAL-HEIGHTS', 'Federal Heights', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-federal-heights', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FEDERAL-HEIGHTS'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-estes-park', 'ESTES-PARK', 'Estes Park', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-estes-park', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license. Exemptions changed 2026-07-01.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'ESTES-PARK'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-arvada', 'ARVADA', 'Arvada', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-arvada', j."id", 'ALWAYS', 'CITY_PORTAL', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed; not in SUTS.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'ARVADA'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-new-raymer', 'NEW-RAYMER', 'New Raymer', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-new-raymer', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'NEW-RAYMER'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-log-lane-village', 'LOG-LANE-VILLAGE', 'Log Lane Village', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-log-lane-village', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LOG-LANE-VILLAGE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-lakeside', 'LAKESIDE', 'Lakeside', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-lakeside', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LAKESIDE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-mountain-view', 'MOUNTAIN-VIEW', 'Mountain View', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-mountain-view', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'MOUNTAIN-VIEW'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-bennett', 'BENNETT', 'Bennett', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-bennett', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license. RTD share in the Adams part is unconfirmed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BENNETT'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-ward', 'WARD', 'Ward', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-ward', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WARD'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-fort-morgan', 'FORT-MORGAN', 'Fort Morgan', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-fort-morgan', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FORT-MORGAN'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-wheat-ridge', 'WHEAT-RIDGE', 'Wheat Ridge', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-wheat-ridge', j."id", 'ALWAYS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license presumed.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WHEAT-RIDGE'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-edgewater', 'EDGEWATER', 'Edgewater', 'CITY', 'STATE_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-edgewater', j."id", 'NONE', 'STATE_RETURN', NULL, '2026-10-25T00:00:00.000Z', 'REVIEWED', 'State-collected: no tax on rent when tax was paid at purchase (DOR lease guidance, High); no city license.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'EDGEWATER'
ON CONFLICT ("jurisdictionId") DO NOTHING;

INSERT INTO "TaxJurisdiction" ("id", "code", "name", "level", "administration", "reviewStatus", "createdAt", "updatedAt")
VALUES ('feetax2-lakewood', 'LAKEWOOD', 'Lakewood', 'CITY', 'SELF_COLLECTED', 'NEEDS_REVIEW', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "JurisdictionReadiness" ("id", "jurisdictionId", "licenseRequired", "filesThrough", "sourceUrl", "checkedOn", "reviewStatus", "notes", "createdAt", "updatedAt")
SELECT 'feetax2-readiness-lakewood', j."id", 'AFTER_SECOND_DELIVERY_IN_12_MONTHS', 'SUTS', NULL, '2026-10-25T00:00:00.000Z', 'NEEDS_REVIEW', 'Rent rule not found; license required after more than one delivery in 12 months or renting property in the city (High). Edge of the 50-mile table (50.1 mi).', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'LAKEWOOD'
ON CONFLICT ("jurisdictionId") DO NOTHING;
