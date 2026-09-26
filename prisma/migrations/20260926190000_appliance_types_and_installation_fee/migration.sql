-- Two additive, non-destructive changes requested by Chris after using
-- the Phase 2 desk settings for the first time:
--
-- 1. ApplianceType.isActive — lets an owner/admin retire an appliance
--    category from /desk/settings without breaking existing Lead /
--    PricingRule / Appliance rows that reference it (a hard delete
--    would violate their foreign keys, or silently orphan history).
--
-- 2. ApplianceType.photoUrl — a real photo of a basic/representative
--    model, replacing the icon fallback once Chris supplies one. Also
--    fixes a real bug: the public site was hard-coding "washer" vs.
--    "dryer" vs. "set" icon logic by slug, which silently showed the
--    wrong icon for any new appliance category (a fridge would get a
--    washer icon). Rendering now keys off this field instead.
--
-- 3. BusinessSettings.oneTimeInstallationFeeCents — delivery and
--    installation were previously one combined fee ("delivery/
--    installation"); Chris wants them as two independent, separately
--    priced line items.
--
-- Both are additive columns with safe defaults, so existing rows need
-- no backfill.
ALTER TABLE "ApplianceType" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ApplianceType" ADD COLUMN "photoUrl" TEXT;

ALTER TABLE "BusinessSettings" ADD COLUMN "oneTimeInstallationFeeCents" INTEGER NOT NULL DEFAULT 0;
