-- Requested by Chris while using the new Inventory page for the first
-- time (he has no inventory yet, but wants the system ready to capture
-- this as he obtains appliances):
--
-- 1. Appliance.color — a plain text field (e.g. "White", "Stainless").
--
-- 2. Appliance.features — free-form descriptive tags (e.g. "front-load",
--    "top-load", "agitator" for a washer; different tags entirely for
--    other appliance types). Deliberately a JSON string array, not an
--    enum or fixed per-category column list, so a brand-new appliance
--    category or a feature nobody anticipated never needs a schema
--    change — consistent with how ApplianceType itself works (see the
--    "appliance categories are added as data" migration above this one).
--
-- 3. PartRecord — a small parts knowledge base keyed by MODEL NUMBER
--    (not by an individual physical Appliance): once Chris looks up the
--    part number for something on a given model, that's reusable for
--    every unit of that model he ever owns, not just the one he was
--    repairing when he found it.
--
-- All additive/new, no backfill needed for existing rows.

ALTER TABLE "Appliance" ADD COLUMN "color" TEXT;
ALTER TABLE "Appliance" ADD COLUMN "features" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "PartRecord" (
    "id" TEXT NOT NULL,
    "modelNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "applianceTypeId" TEXT,
    "partNumber" TEXT NOT NULL,
    "partName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PartRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartRecord_modelNumber_idx" ON "PartRecord"("modelNumber");

ALTER TABLE "PartRecord" ADD CONSTRAINT "PartRecord_applianceTypeId_fkey"
    FOREIGN KEY ("applianceTypeId") REFERENCES "ApplianceType"("id");
