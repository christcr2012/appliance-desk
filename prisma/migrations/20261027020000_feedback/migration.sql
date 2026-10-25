-- Additive (MCP-10a: the in-app "App feedback" box, people only). New tables and enums, two new settings columns and
-- one starting job role gaining the new screen. Nothing existing is removed or rewritten.

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('BUG', 'IMPROVEMENT');

-- CreateEnum
CREATE TYPE "FeedbackAiReview" AS ENUM ('HUMAN_ONLY', 'ALLOWED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FeedbackVisibility" AS ENUM ('REPORTER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "FeedbackState" AS ENUM ('SUBMITTED', 'TRIAGED', 'NEEDS_INFORMATION', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_VERIFICATION', 'RESOLVED', 'DUPLICATE', 'DECLINED', 'CLOSED');

-- CreateTable
CREATE TABLE "FeedbackReport" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reporterRole" "Role" NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(8000) NOT NULL,
    "expected" VARCHAR(2000),
    "steps" VARCHAR(4000),
    "routeTemplate" VARCHAR(200) NOT NULL,
    "appRevision" VARCHAR(40),
    "safeContext" JSONB NOT NULL,
    "aiReview" "FeedbackAiReview" NOT NULL DEFAULT 'HUMAN_ONLY',
    "state" "FeedbackState" NOT NULL DEFAULT 'SUBMITTED',
    "awaitingTeam" BOOLEAN NOT NULL DEFAULT true,
    "duplicateOfId" TEXT,
    "requestKey" VARCHAR(64) NOT NULL,
    "contentRemovedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id"),
    -- A report never points at itself as "already reported".
    CONSTRAINT "FeedbackReport_duplicate_not_self_check" CHECK ("duplicateOfId" IS NULL OR "duplicateOfId" <> "id")
);

-- CreateTable
CREATE TABLE "FeedbackEntry" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "visibility" "FeedbackVisibility" NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackAttachment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeedbackAttachment_pathname_check" CHECK ("pathname" LIKE 'feedback/%')
);

-- CreateTable
CREATE TABLE "FeedbackEvent" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" VARCHAR(40) NOT NULL,
    "fromState" "FeedbackState",
    "toState" "FeedbackState",
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackReport_number_key" ON "FeedbackReport"("number");

-- CreateIndex
CREATE INDEX "FeedbackReport_reporterUserId_createdAt_id_idx" ON "FeedbackReport"("reporterUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "FeedbackReport_state_kind_updatedAt_id_idx" ON "FeedbackReport"("state", "kind", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackReport_reporterUserId_requestKey_key" ON "FeedbackReport"("reporterUserId", "requestKey");

-- CreateIndex
CREATE INDEX "FeedbackEntry_reportId_createdAt_id_idx" ON "FeedbackEntry"("reportId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackAttachment_pathname_key" ON "FeedbackAttachment"("pathname");

-- CreateIndex
CREATE INDEX "FeedbackAttachment_reportId_idx" ON "FeedbackAttachment"("reportId");

-- CreateIndex
CREATE INDEX "FeedbackEvent_reportId_createdAt_idx" ON "FeedbackEvent"("reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReport" ADD CONSTRAINT "FeedbackReport_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "FeedbackReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEntry" ADD CONSTRAINT "FeedbackEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FeedbackReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEntry" ADD CONSTRAINT "FeedbackEntry_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackAttachment" ADD CONSTRAINT "FeedbackAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FeedbackReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "FeedbackReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owner settings (Settings > App feedback): pictures allowed per report (starting value 3) and the reopen window
-- (starting value 90 days after a report is done).
ALTER TABLE "BusinessSettings" ADD COLUMN "feedbackMaxAttachments" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "feedbackReopenDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_feedbackMaxAttachments_check" CHECK ("feedbackMaxAttachments" BETWEEN 0 AND 3),
  ADD CONSTRAINT "BusinessSettings_feedbackReopenDays_check" CHECK ("feedbackReopenDays" BETWEEN 1 AND 365);

-- The starting "Manager" job role has every screen; it gains the new owner/admin "App feedback" screen. A Manager role
-- the owner already edited keeps the owner's choice only if it no longer matches the starting list exactly.
UPDATE "JobRole"
SET "screens" = "screens" || '["feedback"]'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'jobrole-manager'
  AND "isStarter" = true
  AND "screens" = '["tasks", "leads", "customers", "communications", "agreements", "phone-orders", "estimates", "dispatch", "maintenance", "inventory", "billing", "sales-tax", "books", "expenses", "suppliers", "activity", "management"]'::jsonb;
