-- S-2: private, revocable owner-generated check-up access (hashes only).
CREATE TABLE "OpsAgentKey" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OpsAgentKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpsAgentKey_label_nonempty" CHECK (char_length("label") BETWEEN 2 AND 80),
  CONSTRAINT "OpsAgentKey_hash_length" CHECK ("keyHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "OpsAgentKey_keyHash_key" ON "OpsAgentKey"("keyHash");
CREATE INDEX "OpsAgentKey_createdByUserId_revokedAt_idx" ON "OpsAgentKey"("createdByUserId", "revokedAt");
ALTER TABLE "SystemIssueNote"
  ADD CONSTRAINT "SystemIssueNote_authorKeyId_fkey"
  FOREIGN KEY ("authorKeyId") REFERENCES "OpsAgentKey"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
