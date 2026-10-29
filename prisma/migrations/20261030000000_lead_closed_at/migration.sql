-- AR-9: when a lead was won or lost (Lead.closedAt), plus the goal pace
-- owner settings. Additive only.
ALTER TABLE "Lead" ADD COLUMN "closedAt" TIMESTAMP(3);
CREATE INDEX "Lead_status_closedAt_idx" ON "Lead"("status", "closedAt");
ALTER TABLE "BusinessSettings" ADD COLUMN "goalQuietDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "BusinessSettings" ADD COLUMN "goalBehindPercent" INTEGER NOT NULL DEFAULT 75;

-- Backfill closedAt from each closed lead's newest lead.status / lead.convert
-- audit row. Leads with no audit row keep null and are left out of
-- time-based win rates (the Insights definitions say so).
UPDATE "Lead" l SET "closedAt" = a."createdAt" FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt" FROM "AuditLog" WHERE action IN ('lead.status','lead.convert') ORDER BY "entityId", "createdAt" DESC) a WHERE a."entityId" = l.id AND l.status IN ('CONVERTED','LOST');
