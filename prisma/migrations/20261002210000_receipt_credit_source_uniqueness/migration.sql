-- PostgreSQL ordinary UNIQUE constraints treat NULL values as distinct.
-- Batch B provenance uses side=NULL for non-referral credits, so the Prisma
-- @@unique([sourceType, sourceId, side]) constraint alone does not prevent two
-- overpayment credits from being minted for one receipt. Enforce that case
-- explicitly while retaining the existing 3-column unique key for referral
-- sides such as referrer/referred.
CREATE UNIQUE INDEX "CustomerCredit_source_without_side_key"
  ON "CustomerCredit" ("sourceType", "sourceId")
  WHERE "sourceType" IS NOT NULL
    AND "sourceId" IS NOT NULL
    AND "side" IS NULL;
