-- CRM buildout (2026-09-29, Chris's own request — docs/DECISIONS.md has
-- the full writeup) — six pieces, three of which turned out to already
-- exist (contact/communication history and separate contacts for
-- customers, and a combined activity view). This migration covers the
-- three genuinely new pieces:
--
-- 1. LeadNote — the same per-entry contact-log pattern CustomerNote
--    already gives customers, extended to leads (which only had one
--    flat Lead.notes field before this).
-- 2. Lead.lostReason — why a lead was marked LOST.
-- 3. StaffTask — a staff member's own follow-up reminder, optionally
--    linked to a lead, customer, or job.

ALTER TABLE "Lead" ADD COLUMN "lostReason" TEXT;

CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeadNote_leadId_idx" ON "LeadNote"("leadId");

ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "leadId" TEXT,
    "customerId" TEXT,
    "jobId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffTask_completedAt_dueDate_idx" ON "StaffTask"("completedAt", "dueDate");
CREATE INDEX "StaffTask_leadId_idx" ON "StaffTask"("leadId");
CREATE INDEX "StaffTask_customerId_idx" ON "StaffTask"("customerId");
CREATE INDEX "StaffTask_jobId_idx" ON "StaffTask"("jobId");

ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
