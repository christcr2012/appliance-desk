-- Additive (Batch M, shop sales). Every new column has a safe default, so nothing changes until the owner opts in.
ALTER TYPE "PartMovementKind" ADD VALUE IF NOT EXISTS 'SALE';
ALTER TYPE "PartMovementKind" ADD VALUE IF NOT EXISTS 'SALVAGE';

ALTER TABLE "PartRecord"
  ADD COLUMN IF NOT EXISTS "sellable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "retailPriceCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "defaultForResale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "resaleUnitsOnHand" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "resaleCostOnHandCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PartRecord"
  ADD CONSTRAINT "PartRecord_resale_within_stock"
  CHECK ("resaleUnitsOnHand" >= 0 AND "resaleUnitsOnHand" <= "quantityOnHand" AND "resaleCostOnHandCents" >= 0 AND ("retailPriceCents" IS NULL OR "retailPriceCents" >= 0));

ALTER TABLE "PurchaseOrderLineItem" ADD COLUMN IF NOT EXISTS "forResale" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PartStockMovement"
  ADD COLUMN IF NOT EXISTS "resaleUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "resaleCostCents" INTEGER NOT NULL DEFAULT 0;
