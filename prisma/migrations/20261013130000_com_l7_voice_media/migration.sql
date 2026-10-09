-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallSessionState" AS ENUM ('NEW', 'RINGING', 'CONNECTED', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('ANSWERED', 'MISSED', 'VOICEMAIL', 'DECLINED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallLegRole" AS ENUM ('INBOUND', 'FORWARD', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "CallLegStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommunicationMediaKind" AS ENUM ('VOICEMAIL', 'RECORDING', 'TRANSCRIPT');

-- CreateEnum
CREATE TYPE "CommunicationMediaState" AS ENUM ('PENDING', 'AVAILABLE', 'FAILED', 'DELETED');

-- CreateTable
CREATE TABLE "CallSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessNumberId" TEXT NOT NULL,
    "contactPointId" TEXT,
    "threadId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "providerRootCallId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "routingPolicyVersion" INTEGER NOT NULL DEFAULT 0,
    "state" "CallSessionState" NOT NULL DEFAULT 'NEW',
    "outcome" "CallOutcome",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "disposition" TEXT,
    "dispositionNoteEncrypted" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLeg" (
    "id" TEXT NOT NULL,
    "callSessionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerCallId" TEXT NOT NULL,
    "providerParentCallId" TEXT,
    "role" "CallLegRole" NOT NULL,
    "status" "CallLegStatus" NOT NULL DEFAULT 'QUEUED',
    "sequenceNumber" INTEGER,
    "durationSeconds" INTEGER,
    "answeredByStaffAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CallLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMedia" (
    "id" TEXT NOT NULL,
    "callSessionId" TEXT NOT NULL,
    "kind" "CommunicationMediaKind" NOT NULL,
    "providerResourceId" TEXT NOT NULL,
    "privateStorageKey" TEXT,
    "contentHash" TEXT,
    "durationSeconds" INTEGER,
    "state" "CommunicationMediaState" NOT NULL DEFAULT 'PENDING',
    "accessPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "retentionUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallSession_threadId_startedAt_id_idx" ON "CallSession"("threadId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "CallSession_outcome_startedAt_idx" ON "CallSession"("outcome", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_accountId_providerRootCallId_key" ON "CallSession"("accountId", "providerRootCallId");

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_accountId_id_key" ON "CallSession"("accountId", "id");

-- CreateIndex
CREATE INDEX "CallLeg_callSessionId_idx" ON "CallLeg"("callSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CallLeg_accountId_providerCallId_key" ON "CallLeg"("accountId", "providerCallId");

-- CreateIndex
CREATE INDEX "CommunicationMedia_state_createdAt_idx" ON "CommunicationMedia"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMedia_callSessionId_kind_providerResourceId_key" ON "CommunicationMedia"("callSessionId", "kind", "providerResourceId");

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_accountId_businessNumberId_fkey" FOREIGN KEY ("accountId", "businessNumberId") REFERENCES "BusinessPhoneNumber"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_accountId_threadId_fkey" FOREIGN KEY ("accountId", "threadId") REFERENCES "CommunicationThread"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLeg" ADD CONSTRAINT "CallLeg_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLeg" ADD CONSTRAINT "CallLeg_accountId_callSessionId_fkey" FOREIGN KEY ("accountId", "callSessionId") REFERENCES "CallSession"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMedia" ADD CONSTRAINT "CommunicationMedia_callSessionId_fkey" FOREIGN KEY ("callSessionId") REFERENCES "CallSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- COM-L7 fail-closed metadata invariants; no media is publicly fetchable.
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_time_order"
  CHECK (("connectedAt" IS NULL OR "connectedAt" >= "startedAt")
    AND ("endedAt" IS NULL OR "endedAt" >= "startedAt")
    AND ("connectedAt" IS NULL OR "endedAt" IS NULL OR "endedAt" >= "connectedAt"));
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_version_positive"
  CHECK ("version" > 0 AND "routingPolicyVersion" >= 0);
ALTER TABLE "CallLeg" ADD CONSTRAINT "CallLeg_nonnegative_duration"
  CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);
ALTER TABLE "CallLeg" ADD CONSTRAINT "CallLeg_time_order"
  CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "CommunicationMedia" ADD CONSTRAINT "CommunicationMedia_private_key"
  CHECK ("privateStorageKey" IS NULL OR (
    length("privateStorageKey") <= 512 AND
    "privateStorageKey" !~* '^([a-z][a-z0-9+.-]*:|/|\\\\)' ));
ALTER TABLE "CommunicationMedia" ADD CONSTRAINT "CommunicationMedia_state_consistent"
  CHECK (
    ("state" <> 'AVAILABLE' OR ("privateStorageKey" IS NOT NULL AND "contentHash" IS NOT NULL))
    AND ("state" <> 'DELETED' OR ("deletedAt" IS NOT NULL AND "privateStorageKey" IS NULL))
    AND ("deletedAt" IS NULL OR "state" = 'DELETED')
    AND (NOT "legalHold" OR "deletedAt" IS NULL)
  );
ALTER TABLE "CommunicationMedia" ADD CONSTRAINT "CommunicationMedia_nonnegative_duration"
  CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);
ALTER TABLE "CommunicationMedia" ADD CONSTRAINT "CommunicationMedia_retention_after_creation"
  CHECK ("retentionUntil" IS NULL OR "retentionUntil" >= "createdAt");

-- A legal hold prevents raw deletion, including out-of-band table deletes.
CREATE FUNCTION "prevent_held_media_delete"() RETURNS trigger AS $$
BEGIN
  IF OLD."legalHold" THEN
    RAISE EXCEPTION 'Protected communication media cannot be deleted while legal hold is active';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CommunicationMedia_legal_hold_delete"
  BEFORE DELETE ON "CommunicationMedia"
  FOR EACH ROW EXECUTE FUNCTION "prevent_held_media_delete"();
