-- All existing approvals receive a new generation; a reconnect rotates it again.
-- A single additive column with a generated default is non-destructive.
ALTER TABLE "McpConnection" ADD COLUMN "grantVersion" TEXT NOT NULL DEFAULT (gen_random_uuid()::text);
