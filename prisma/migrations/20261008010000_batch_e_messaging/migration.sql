-- Batch E: durable automation/message foundations and post-D lead scoring state.

CREATE TYPE "AutomationRunState" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'SKIPPED');
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS');
CREATE TYPE "MessagePurpose" AS ENUM ('TRANSACTIONAL', 'MARKETING');
CREATE TYPE "MessageState" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'NOT_SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED');

CREATE TABLE "AutomationRun" (
  "id" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "state" "AutomationRunState" NOT NULL DEFAULT 'RUNNING',
  "environment" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "budgetSeconds" INTEGER NOT NULL DEFAULT 300,
  "counts" JSONB,
  "error" TEXT,
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationRun_ruleKey_runKey_key" ON "AutomationRun"("ruleKey", "runKey");
CREATE INDEX "AutomationRun_ruleKey_startedAt_idx" ON "AutomationRun"("ruleKey", "startedAt");

CREATE TABLE "MessageDelivery" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "channel" "MessageChannel" NOT NULL,
  "purpose" "MessagePurpose" NOT NULL,
  "templateKey" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "recipientId" TEXT,
  "recipientAddress" TEXT NOT NULL,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "state" "MessageState" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "lastError" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageDelivery_idempotencyKey_key" ON "MessageDelivery"("idempotencyKey");
CREATE UNIQUE INDEX "MessageDelivery_providerMessageId_key" ON "MessageDelivery"("providerMessageId");
CREATE INDEX "MessageDelivery_recipientType_recipientId_requestedAt_idx" ON "MessageDelivery"("recipientType", "recipientId", "requestedAt");
CREATE INDEX "MessageDelivery_subjectType_subjectId_idx" ON "MessageDelivery"("subjectType", "subjectId");
CREATE INDEX "MessageDelivery_state_requestedAt_idx" ON "MessageDelivery"("state", "requestedAt");

CREATE TABLE "ProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "summary" JSONB,
  CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderEvent_provider_eventId_key" ON "ProviderEvent"("provider", "eventId");

CREATE TABLE "MarketingSuppression" (
  "id" TEXT NOT NULL,
  "channel" "MessageChannel" NOT NULL,
  "address" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingSuppression_channel_address_key" ON "MarketingSuppression"("channel", "address");

ALTER TABLE "LaunchSubscriber"
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmTokenHash" TEXT,
  ADD COLUMN "confirmExpiresAt" TIMESTAMP(3);

ALTER TABLE "Lead"
  ADD COLUMN "lastRealContactAt" TIMESTAMP(3),
  ADD COLUMN "scoringPolicyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "BusinessSettings"
  ADD COLUMN "pausedAutomations" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "leadScoringPolicy" JSONB NOT NULL DEFAULT '{"version":1,"termPoints":{"month-to-month":0,"6-month":10,"12-month":20},"additionalUnitPoints":5,"businessAccountPoints":10,"multiUnitPropertyManagerPoints":25,"highValueThreshold":30}';
