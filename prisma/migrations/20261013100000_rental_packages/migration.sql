-- W-16A (Batch W Amendment B, D-WB3): rental packages. A set is a package of separate machines, never an
-- appliance type. Additive tables/columns, then a one-time, re-runnable data step for the old set type.

-- AlterTable
ALTER TABLE "LeadApplianceRequest" ADD COLUMN     "packageId" TEXT;

-- AlterTable
ALTER TABLE "RentalLine" ADD COLUMN     "packageId" TEXT;

-- AlterTable
ALTER TABLE "EstimateLineItem" ADD COLUMN     "packageId" TEXT;

-- CreateTable
CREATE TABLE "RentalPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "showOnWebsite" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalPackageComponent" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "applianceTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RentalPackageComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalPackage_name_key" ON "RentalPackage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RentalPackage_slug_key" ON "RentalPackage"("slug");

-- CreateIndex
CREATE INDEX "RentalPackageComponent_applianceTypeId_idx" ON "RentalPackageComponent"("applianceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalPackageComponent_packageId_applianceTypeId_key" ON "RentalPackageComponent"("packageId", "applianceTypeId");

-- CreateIndex
CREATE INDEX "LeadApplianceRequest_packageId_idx" ON "LeadApplianceRequest"("packageId");

-- CreateIndex
CREATE INDEX "RentalLine_packageId_idx" ON "RentalLine"("packageId");

-- CreateIndex
CREATE INDEX "EstimateLineItem_packageId_idx" ON "EstimateLineItem"("packageId");

-- AddForeignKey
ALTER TABLE "LeadApplianceRequest" ADD CONSTRAINT "LeadApplianceRequest_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPackageComponent" ADD CONSTRAINT "RentalPackageComponent_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPackageComponent" ADD CONSTRAINT "RentalPackageComponent_applianceTypeId_fkey" FOREIGN KEY ("applianceTypeId") REFERENCES "ApplianceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalLine" ADD CONSTRAINT "RentalLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLineItem" ADD CONSTRAINT "EstimateLineItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guard rails the app also checks.
ALTER TABLE "RentalPackage" ADD CONSTRAINT "RentalPackage_price_nonnegative" CHECK ("monthlyPriceCents" >= 0);
ALTER TABLE "RentalPackageComponent" ADD CONSTRAINT "RentalPackageComponent_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);

-- Moving existing data: the "Washer + Dryer Set" appliance type becomes the "Washer + Dryer Set" package (price,
-- website flag, order and photo kept), made of the existing Washer and Dryer types; quote requests that asked for the
-- set point at the package; the type is retired so nothing new is created under it. Signed agreements, rental lines and
-- appliances are not touched (old set appliances get a "split" To do in W-16B). Does nothing when the type is absent.
INSERT INTO "RentalPackage" ("id", "name", "slug", "monthlyPriceCents", "showOnWebsite", "sortOrder", "isActive", "photoUrl", "updatedAt")
SELECT 'rental-package-washer-dryer-set', t."name", t."slug", t."monthlyPriceCents", t."showOnWebsite", t."sortOrder", true, t."photoUrl", CURRENT_TIMESTAMP
FROM "ApplianceType" t
WHERE t."slug" = 'washer-dryer-set'
ON CONFLICT DO NOTHING;

INSERT INTO "RentalPackageComponent" ("id", "packageId", "applianceTypeId", "quantity")
SELECT 'rental-package-washer-dryer-set-' || t."slug", p."id", t."id", 1
FROM "RentalPackage" p
JOIN "ApplianceType" t ON t."slug" IN ('washer', 'dryer')
WHERE p."id" = 'rental-package-washer-dryer-set'
ON CONFLICT DO NOTHING;

UPDATE "LeadApplianceRequest" r
SET "packageId" = 'rental-package-washer-dryer-set'
FROM "ApplianceType" t
WHERE r."applianceTypeId" = t."id" AND t."slug" = 'washer-dryer-set' AND r."packageId" IS NULL
  AND EXISTS (SELECT 1 FROM "RentalPackage" p WHERE p."id" = 'rental-package-washer-dryer-set');

UPDATE "ApplianceType"
SET "isActive" = false, "showOnWebsite" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'washer-dryer-set'
  AND EXISTS (SELECT 1 FROM "RentalPackage" p WHERE p."id" = 'rental-package-washer-dryer-set');
