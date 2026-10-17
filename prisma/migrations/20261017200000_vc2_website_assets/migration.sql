-- V-C2: website pictures. Additive only.
CREATE TYPE "WebsiteAssetState" AS ENUM ('DRAFT', 'PUBLIC', 'RETIRED');

CREATE TABLE "WebsiteAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "state" "WebsiteAssetState" NOT NULL DEFAULT 'DRAFT',
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteAsset_storageKey_key" ON "WebsiteAsset"("storageKey");
CREATE INDEX "WebsiteAsset_state_createdAt_id_idx" ON "WebsiteAsset"("state", "createdAt", "id");
CREATE INDEX "WebsiteAsset_sha256_idx" ON "WebsiteAsset"("sha256");
