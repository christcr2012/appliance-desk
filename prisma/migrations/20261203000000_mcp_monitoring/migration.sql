-- MCP-7: additive, disabled-by-default owner monitoring rules and immutable daily slots.
CREATE TABLE "MonitorRule" (
  "id" TEXT NOT NULL, "key" VARCHAR(60) NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "failuresBeforeAlert" INTEGER NOT NULL DEFAULT 2, "cooldownHours" INTEGER NOT NULL DEFAULT 24,
  "notifyEmail" BOOLEAN NOT NULL DEFAULT false, "autoAction" VARCHAR(60),
  "autoActionConnectionId" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonitorRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonitorRule_key_key" ON "MonitorRule"("key");
CREATE TABLE "MonitorRun" (
  "id" TEXT NOT NULL, "ruleKey" VARCHAR(60) NOT NULL, "slot" VARCHAR(20) NOT NULL,
  "state" VARCHAR(12) NOT NULL, "consecutiveFailures" INTEGER NOT NULL,
  "notifiedAt" TIMESTAMP(3), "operationId" TEXT, "emailErrorCode" VARCHAR(60),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitorRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonitorRun_ruleKey_slot_key" ON "MonitorRun"("ruleKey", "slot");
CREATE INDEX "MonitorRun_ruleKey_createdAt_idx" ON "MonitorRun"("ruleKey", "createdAt");

-- Extend the existing allowlist without changing any existing issue rows.
ALTER TABLE "SystemIssue" DROP CONSTRAINT "SystemIssue_kind_known";
ALTER TABLE "SystemIssue" ADD CONSTRAINT "SystemIssue_kind_known" CHECK ("kind" IN (
  'AUTOMATION_FAILED','AUTOMATION_STALE','PROVIDER_OPERATION_STUCK',
  'TAX_LOOKUP_UNAVAILABLE','TAX_PERIOD_MISSING','USE_TAX_FORM_MISSING',
  'SOURCE_PAGE_UNREACHABLE','SOURCE_PAGE_CHANGED','TAX_RATE_GUARDRAIL',
  'MESSAGE_DELIVERY_UNKNOWN','TELECOM_SYNC_STALE','TELECOM_STATEMENT_DIFFERENCE',
  'TELECOM_CONTACTS_UNRESOLVED','CONFIGURATION_MISSING','BOOKS_POSTING_FAILURE',
  'BOOKS_STRIPE_CLEARING_DIFFERENCE','ASSISTANT_ACTION_UNCERTAIN','MONITOR_ALERT'
));
