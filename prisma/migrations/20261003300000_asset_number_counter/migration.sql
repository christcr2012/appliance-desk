-- Batch C P1-B: per-prefix asset number counter; numbers are never reused.
CREATE TABLE "AssetNumberCounter" ("prefix" TEXT NOT NULL, "nextSequence" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AssetNumberCounter_pkey" PRIMARY KEY ("prefix"));
ALTER TABLE "AssetNumberCounter" ADD CONSTRAINT "AssetNumberCounter_next_positive" CHECK ("nextSequence" >= 1);
INSERT INTO "AssetNumberCounter" ("prefix","nextSequence","updatedAt")
SELECT split_part("assetNumber",'-',1), MAX(CAST(split_part("assetNumber",'-',2) AS INTEGER)) + 1, NOW()
FROM "Appliance" WHERE "assetNumber" ~ '^[A-Z0-9]{1,6}-[0-9]{1,9}$'
GROUP BY split_part("assetNumber",'-',1)
ON CONFLICT ("prefix") DO NOTHING;
