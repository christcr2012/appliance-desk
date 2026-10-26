-- Additive (LD-1: leads pipeline engine). New nullable lead columns (owner,
-- first contact, normalized contact keys, duplicate/merge state), a kind on
-- LeadNote, and the three lead-assignment settings. Nothing existing is
-- removed or rewritten; old rows are backfilled from the history they have
-- (first contact from lastRealContactAt, owner from the oldest active OWNER).

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "firstContactedAt" TIMESTAMP(3),
ADD COLUMN     "firstContactEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneDigits" TEXT,
ADD COLUMN     "emailLower" TEXT,
ADD COLUMN     "possibleDuplicateOfLeadId" TEXT,
ADD COLUMN     "mergedIntoLeadId" TEXT,
ADD COLUMN     "mergedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadNote" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'NOTE';

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "leadAssignmentMode" TEXT NOT NULL DEFAULT 'OWNER',
ADD COLUMN     "leadAssignmentUserId" TEXT,
ADD COLUMN     "leadRotationCursor" TEXT;

-- CreateIndex
CREATE INDEX "Lead_assignedToUserId_status_nextFollowUpOn_idx" ON "Lead"("assignedToUserId", "status", "nextFollowUpOn");
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
CREATE INDEX "Lead_phoneDigits_idx" ON "Lead"("phoneDigits");
CREATE INDEX "Lead_emailLower_idx" ON "Lead"("emailLower");
CREATE INDEX "Lead_mergedIntoLeadId_idx" ON "Lead"("mergedIntoLeadId");

-- Backfill (all idempotent: each UPDATE only touches rows still missing the value).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
UPDATE "Lead" SET "phoneDigits" = NULLIF(regexp_replace("phone", '\D', '', 'g'), '');
UPDATE "Lead" SET "emailLower" = NULLIF(lower(trim("email")), '');
-- History: leads already past NEW were contacted at some point; the best record we have is lastRealContactAt.
UPDATE "Lead" SET "firstContactedAt" = "lastRealContactAt", "firstContactEstimated" = true
  WHERE "status" <> 'NEW' AND "firstContactedAt" IS NULL AND "lastRealContactAt" IS NOT NULL;
-- New leads get an owner: the business owner (the oldest active OWNER user).
UPDATE "Lead" SET "assignedToUserId" = (SELECT "id" FROM "User" WHERE "role" = 'OWNER' AND "archivedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 1)
  WHERE "assignedToUserId" IS NULL AND "status" IN ('NEW','CONTACTED');
CREATE INDEX IF NOT EXISTS "Lead_contactName_trgm" ON "Lead" USING gin ("contactName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_companyName_trgm" ON "Lead" USING gin ("companyName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_city_trgm" ON "Lead" USING gin ("city" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_emailLower_trgm" ON "Lead" USING gin ("emailLower" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_phoneDigits_trgm" ON "Lead" USING gin ("phoneDigits" gin_trgm_ops);
