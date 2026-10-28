-- MCP-5: durable owner-approved assistant operation journal.
-- No existing row is touched. The application does not activate any action by this migration.
CREATE TYPE "AgentOperationState" AS ENUM (
  'PREVIEWED', 'AWAITING_APPROVAL', 'AUTHORIZED', 'RUNNING', 'SUCCEEDED',
  'FAILED', 'UNKNOWN', 'DENIED', 'CANCELLED', 'EXPIRED'
);
CREATE TABLE "AgentOperation" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "tool" VARCHAR(80) NOT NULL,
  "action" VARCHAR(60) NOT NULL,
  "targetRef" VARCHAR(120),
  "requestKeyDigest" CHAR(64) NOT NULL,
  "argsHash" CHAR(64) NOT NULL,
  "args" JSONB NOT NULL,
  "previewHash" CHAR(64),
  "preview" JSONB,
  "verifyIntent" JSONB,
  "state" "AgentOperationState" NOT NULL,
  "leaseToken" CHAR(32),
  "leaseExpiresAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "safeResult" JSONB,
  "failureCode" VARCHAR(60),
  "verification" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentOperation_connectionId_tool_requestKeyDigest_key"
  ON "AgentOperation"("connectionId", "tool", "requestKeyDigest");
CREATE INDEX "AgentOperation_state_leaseExpiresAt_idx" ON "AgentOperation"("state", "leaseExpiresAt");
CREATE INDEX "AgentOperation_actorUserId_createdAt_idx" ON "AgentOperation"("actorUserId", "createdAt");
ALTER TABLE "AgentOperation"
  ADD CONSTRAINT "AgentOperation_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
