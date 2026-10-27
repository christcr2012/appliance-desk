-- VAULT-2: the logins vault and emergency access (spec RECORDS-VAULT §§4-7).
-- VaultCredential holds business logins with the secret fields encrypted
-- under the separate VAULT_ENCRYPTION_KEY (never the compliance key).
-- VaultUnlock is a 5-minute proof that this session entered a fresh
-- second-step code; rows are deleted on sign-out-everywhere, password
-- change and second-step change, and are never backed up.
-- EmergencyAccessRequest carries the emergency-access flow (ships OFF in
-- BusinessSettings.emergencyAccessEnabled): the link token and the
-- contact's one-time code are stored only as SHA-256 hashes.
-- BusinessSettings gains the emergency contact + wait settings.

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "emergencyAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emergencyContactEmail" VARCHAR(200),
ADD COLUMN     "emergencyContactName" VARCHAR(120),
ADD COLUMN     "emergencyContactPhone" VARCHAR(40),
ADD COLUMN     "emergencyWaitDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "VaultCredential" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "url" VARCHAR(500),
    "usernameEncrypted" TEXT,
    "passwordEncrypted" TEXT,
    "notesEncrypted" TEXT,
    "totpHint" VARCHAR(120),
    "lastRotatedOn" TIMESTAMP(3),
    "rotateEveryMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "VaultCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultUnlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAccessRequest" (
    "id" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'LINK_READY',
    "contactName" VARCHAR(120),
    "contactEmail" VARCHAR(200),
    "contactPhone" VARCHAR(40),
    "requestedAt" TIMESTAMP(3),
    "waitEndsAt" TIMESTAMP(3),
    "remindedHalfwayAt" TIMESTAMP(3),
    "remindedDayBeforeAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "codeHash" CHAR(64),
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "codeSentAt" TIMESTAMP(3),
    "exportExpiresAt" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EmergencyAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultUnlock_sessionId_expiresAt_idx" ON "VaultUnlock"("sessionId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyAccessRequest_tokenHash_key" ON "EmergencyAccessRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "EmergencyAccessRequest_status_waitEndsAt_idx" ON "EmergencyAccessRequest"("status", "waitEndsAt");


-- The wait is a real safety margin: never shorter than a day, never longer than a month.
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_emergencyWaitDays_check"
  CHECK ("emergencyWaitDays" BETWEEN 1 AND 30);
