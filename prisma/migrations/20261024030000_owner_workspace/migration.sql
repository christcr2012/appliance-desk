-- Additive (Batch O, O-7). One private row per owner/admin; removed with the account. Starts empty.
CREATE TABLE "OwnerWorkspacePreference" (
  "userId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "preferences" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerWorkspacePreference_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "OwnerWorkspacePreference_version_check" CHECK ("version" >= 1)
);
ALTER TABLE "OwnerWorkspacePreference" ADD CONSTRAINT "OwnerWorkspacePreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
