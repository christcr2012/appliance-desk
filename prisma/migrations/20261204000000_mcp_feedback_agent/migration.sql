-- MCP-11: private report consent is already a report column. Add assistant evidence and verified-case links.
CREATE TYPE "FeedbackAuthorKind" AS ENUM ('PERSON', 'ASSISTANT');
ALTER TABLE "FeedbackEntry" ADD COLUMN "authorKind" "FeedbackAuthorKind" NOT NULL DEFAULT 'PERSON',
  ADD COLUMN "agentConnectionId" TEXT;
CREATE TABLE "FeedbackCaseLink" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "repairCaseId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackCaseLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeedbackCaseLink_reportId_repairCaseId_key" ON "FeedbackCaseLink"("reportId", "repairCaseId");
CREATE INDEX "FeedbackCaseLink_repairCaseId_idx" ON "FeedbackCaseLink"("repairCaseId");
ALTER TABLE "FeedbackCaseLink" ADD CONSTRAINT "FeedbackCaseLink_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "FeedbackReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedbackCaseLink" ADD CONSTRAINT "FeedbackCaseLink_repairCaseId_fkey"
  FOREIGN KEY ("repairCaseId") REFERENCES "RepairCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
