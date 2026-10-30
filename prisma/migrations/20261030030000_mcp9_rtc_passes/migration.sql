-- MCP-9: RTC passes are separate from OAuth connector grants.
ALTER TABLE "McpConnection" ADD COLUMN "kind" VARCHAR(12) NOT NULL DEFAULT 'CONNECTOR';
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_kind_check"
  CHECK ("kind" IN ('CONNECTOR','PASS'));

CREATE TABLE "AgentPass" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "profile" VARCHAR(12) NOT NULL DEFAULT 'read_only',
  "areas" TEXT[] NOT NULL,
  "allowWrites" BOOLEAN NOT NULL DEFAULT false,
  "allowProduction" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPass_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentPass_digest_key" ON "AgentPass"("digest");
CREATE INDEX "AgentPass_connectionId_expiresAt_idx" ON "AgentPass"("connectionId","expiresAt");
ALTER TABLE "AgentPass" ADD CONSTRAINT "AgentPass_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AgentResult" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentResult_digest_key" ON "AgentResult"("digest");
CREATE INDEX "AgentResult_connectionId_expiresAt_idx" ON "AgentResult"("connectionId","expiresAt");
ALTER TABLE "AgentResult" ADD CONSTRAINT "AgentResult_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
