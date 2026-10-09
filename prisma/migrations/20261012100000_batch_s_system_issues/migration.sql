-- S-1A: one private, deduplicated registry of operational problems.
CREATE TYPE "SystemIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "SystemIssueSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "SystemIssue" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "SystemIssueSeverity" NOT NULL,
    "status" "SystemIssueStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,
    CONSTRAINT "SystemIssue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SystemIssue_occurrences_positive" CHECK ("occurrences" > 0),
    CONSTRAINT "SystemIssue_version_positive" CHECK ("version" > 0),
    CONSTRAINT "SystemIssue_kind_known" CHECK ("kind" IN (
        'AUTOMATION_FAILED','AUTOMATION_STALE','PROVIDER_OPERATION_STUCK',
        'TAX_LOOKUP_UNAVAILABLE','SOURCE_PAGE_UNREACHABLE','SOURCE_PAGE_CHANGED',
        'TAX_RATE_GUARDRAIL','MESSAGE_DELIVERY_UNKNOWN','CONFIGURATION_MISSING'))
);
CREATE UNIQUE INDEX "SystemIssue_fingerprint_key" ON "SystemIssue"("fingerprint");
CREATE INDEX "SystemIssue_status_severity_lastSeenAt_idx" ON "SystemIssue"("status","severity","lastSeenAt");

CREATE TABLE "SystemIssueNote" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorKeyId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemIssueNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SystemIssueNote_one_author" CHECK (NOT ("authorUserId" IS NOT NULL AND "authorKeyId" IS NOT NULL)),
    CONSTRAINT "SystemIssueNote_body_limit" CHECK (octet_length("body") <= 2048)
);
CREATE INDEX "SystemIssueNote_issueId_createdAt_idx" ON "SystemIssueNote"("issueId","createdAt");
ALTER TABLE "SystemIssueNote" ADD CONSTRAINT "SystemIssueNote_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "SystemIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
