-- MCP-2: no backup credentials, no production-data backfill; additive only.
CREATE TYPE "BackupArtifactKind" AS ENUM ('DATABASE', 'MEDIA_MANIFEST');
CREATE TYPE "BackupArtifactState" AS ENUM ('VERIFIED', 'UPLOADED_UNVERIFIED', 'FAILED', 'PRUNED');
ALTER TABLE "BusinessSettings" ADD COLUMN "backupRetentionDays" INTEGER NOT NULL DEFAULT 30;
CREATE TABLE "BackupArtifact" (
  "id" TEXT NOT NULL,
  "kind" "BackupArtifactKind" NOT NULL,
  "state" "BackupArtifactState" NOT NULL,
  "runId" TEXT,
  "databaseArtifactId" TEXT,
  "pathname" TEXT NOT NULL,
  "formatVersion" INTEGER NOT NULL,
  "migrationId" TEXT,
  "appRevision" TEXT,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "tableCounts" JSONB,
  "photoCounts" JSONB,
  "failureStage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "prunedAt" TIMESTAMP(3),
  CONSTRAINT "BackupArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BackupArtifact_pathname_key" ON "BackupArtifact"("pathname");
CREATE INDEX "BackupArtifact_kind_state_createdAt_idx" ON "BackupArtifact"("kind", "state", "createdAt");
CREATE INDEX "BackupArtifact_databaseArtifactId_idx" ON "BackupArtifact"("databaseArtifactId");
ALTER TABLE "BackupArtifact" ADD CONSTRAINT "BackupArtifact_databaseArtifactId_fkey"
FOREIGN KEY ("databaseArtifactId") REFERENCES "BackupArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
