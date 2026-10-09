-- CreateEnum
CREATE TYPE "CommunicationThreadResolution" AS ENUM ('UNRESOLVED', 'AMBIGUOUS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CommunicationThreadStatus" AS ENUM ('OPEN', 'WAITING', 'CLOSED');

-- CreateEnum
CREATE TYPE "CommunicationMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CommunicationLinkSource" AS ENUM ('EXPLICIT', 'WORKFLOW', 'STAFF_CONFIRMED');

-- CreateEnum
CREATE TYPE "CommunicationLinkEntityType" AS ENUM ('Customer', 'Lead', 'ServiceAddress', 'RentalAgreement', 'Job', 'MaintenanceRequest', 'Invoice', 'Estimate');

-- AlterEnum
ALTER TYPE "MessagePurpose" ADD VALUE 'CONVERSATIONAL';

-- AlterTable
ALTER TABLE "MessageDelivery" ADD COLUMN     "templateRevisionId" TEXT;

-- CreateTable
CREATE TABLE "CommunicationThread" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessNumberId" TEXT NOT NULL,
    "externalContactPointId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "resolution" "CommunicationThreadResolution" NOT NULL DEFAULT 'UNRESOLVED',
    "status" "CommunicationThreadStatus" NOT NULL DEFAULT 'OPEN',
    "assignedUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationReadMarker" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadOccurredAt" TIMESTAMP(3),
    "lastReadMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationReadMarker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "CommunicationMessageDirection" NOT NULL,
    "deliveryId" TEXT,
    "providerResourceId" TEXT,
    "accountId" TEXT NOT NULL,
    "bodyEncrypted" TEXT,
    "bodyHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "consentRecordId" TEXT,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationLink" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "entityType" "CommunicationLinkEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "source" "CommunicationLinkSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,

    CONSTRAINT "CommunicationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTemplateRevision" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "purpose" "MessagePurpose" NOT NULL,
    "body" TEXT NOT NULL,
    "subject" TEXT,
    "triggerKey" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "policy" JSONB NOT NULL DEFAULT '{}',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "CommunicationTemplateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationThread_status_lastActivityAt_id_idx" ON "CommunicationThread"("status", "lastActivityAt", "id");

-- CreateIndex
CREATE INDEX "CommunicationThread_assignedUserId_idx" ON "CommunicationThread"("assignedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationThread_accountId_businessNumberId_externalCont_key" ON "CommunicationThread"("accountId", "businessNumberId", "externalContactPointId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationThread_accountId_id_key" ON "CommunicationThread"("accountId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationReadMarker_threadId_userId_key" ON "CommunicationReadMarker"("threadId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_deliveryId_key" ON "CommunicationMessage"("deliveryId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_threadId_occurredAt_id_idx" ON "CommunicationMessage"("threadId", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_accountId_providerResourceId_key" ON "CommunicationMessage"("accountId", "providerResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_threadId_id_key" ON "CommunicationMessage"("threadId", "id");

-- CreateIndex
CREATE INDEX "CommunicationLink_entityType_entityId_idx" ON "CommunicationLink"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationLink_messageId_entityType_entityId_key" ON "CommunicationLink"("messageId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationTemplateRevision_key_revision_key" ON "CommunicationTemplateRevision"("key", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPhoneNumber_accountId_id_key" ON "BusinessPhoneNumber"("accountId", "id");

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_templateRevisionId_fkey" FOREIGN KEY ("templateRevisionId") REFERENCES "CommunicationTemplateRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_accountId_businessNumberId_fkey" FOREIGN KEY ("accountId", "businessNumberId") REFERENCES "BusinessPhoneNumber"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_externalContactPointId_fkey" FOREIGN KEY ("externalContactPointId") REFERENCES "ContactPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReadMarker" ADD CONSTRAINT "CommunicationReadMarker_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReadMarker" ADD CONSTRAINT "CommunicationReadMarker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReadMarker" ADD CONSTRAINT "CommunicationReadMarker_threadId_lastReadMessageId_fkey" FOREIGN KEY ("threadId", "lastReadMessageId") REFERENCES "CommunicationMessage"("threadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_accountId_threadId_fkey" FOREIGN KEY ("accountId", "threadId") REFERENCES "CommunicationThread"("accountId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "MessageDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationLink" ADD CONSTRAINT "CommunicationLink_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationLink" ADD CONSTRAINT "CommunicationLink_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTemplateRevision" ADD CONSTRAINT "CommunicationTemplateRevision_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTemplateRevision" ADD CONSTRAINT "CommunicationTemplateRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- L3 scope and content integrity: never rely solely on a future UI or queue consumer.
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_one_subject_check"
  CHECK (num_nonnulls("customerId", "leadId") <= 1);
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_version_check"
  CHECK ("version" > 0);
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_direction_evidence_check"
  CHECK (
    ("direction" = 'INBOUND' AND "deliveryId" IS NULL AND
      ("bodyEncrypted" IS NOT NULL OR "redactedAt" IS NOT NULL))
    OR ("direction" = 'OUTBOUND' AND "deliveryId" IS NOT NULL AND "bodyEncrypted" IS NULL)
  );
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_hash_check"
  CHECK (length(btrim("bodyHash")) > 0);
ALTER TABLE "CommunicationLink" ADD CONSTRAINT "CommunicationLink_entity_id_check"
  CHECK (length(btrim("entityId")) > 0);
ALTER TABLE "CommunicationTemplateRevision" ADD CONSTRAINT "CommunicationTemplateRevision_revision_check"
  CHECK ("revision" > 0);
CREATE UNIQUE INDEX "CommunicationTemplateRevision_one_current_key_channel"
  ON "CommunicationTemplateRevision"("key", "channel")
  WHERE "isCurrent" = true;

-- An account may have more than one business number, but never a thread whose
-- contact point belongs to a different environment. Composite FKs above guard
-- the business-number account and the message-thread account.
CREATE FUNCTION "com_l3_thread_environment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "TelecomAccount" account
    JOIN "ContactPoint" point ON point."id" = NEW."externalContactPointId"
    WHERE account."id" = NEW."accountId"
      AND account."environment" = point."environment"
      AND point."channel" = 'SMS'
  ) THEN
    RAISE EXCEPTION 'communication thread contact environment/account mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "com_l3_thread_environment_guard_trigger"
  BEFORE INSERT OR UPDATE OF "accountId", "externalContactPointId"
  ON "CommunicationThread" FOR EACH ROW
  EXECUTE FUNCTION "com_l3_thread_environment_guard"();

-- A visible outbound message cannot borrow an unrelated, unsent or email
-- delivery ledger, even if both database IDs happen to exist.
CREATE FUNCTION "com_l3_outbound_delivery_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."direction" = 'OUTBOUND' AND NOT EXISTS (
    SELECT 1 FROM "MessageDelivery" delivery
    WHERE delivery."id" = NEW."deliveryId"
      AND delivery."telecomAccountId" = NEW."accountId"
      AND delivery."channel" = 'SMS'
  ) THEN
    RAISE EXCEPTION 'outbound communication requires SMS delivery from the same account';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "com_l3_outbound_delivery_guard_trigger"
  BEFORE INSERT OR UPDATE OF "accountId", "deliveryId", "direction"
  ON "CommunicationMessage" FOR EACH ROW
  EXECUTE FUNCTION "com_l3_outbound_delivery_guard"();

-- Versions are append-only content. Selection and initial approval can change,
-- but no sent message can ever silently acquire changed template wording.
-- Serialize family assignment so two concurrent new versions cannot disagree
-- about the key's permanent channel or purpose.
CREATE FUNCTION "com_l3_template_version_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."key"));
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."key", OLD."revision", OLD."channel", OLD."purpose", OLD."body",
        OLD."subject", OLD."triggerKey", OLD."variables", OLD."policy",
        OLD."createdAt", OLD."createdByUserId")
      IS DISTINCT FROM
       (NEW."key", NEW."revision", NEW."channel", NEW."purpose", NEW."body",
        NEW."subject", NEW."triggerKey", NEW."variables", NEW."policy",
        NEW."createdAt", NEW."createdByUserId") THEN
      RAISE EXCEPTION 'template revisions are immutable; create a new revision';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "CommunicationTemplateRevision" prior
    WHERE prior."key" = NEW."key" AND prior."id" <> NEW."id"
      AND (prior."channel" <> NEW."channel" OR prior."purpose" <> NEW."purpose")
  ) THEN
    RAISE EXCEPTION 'template key cannot change channel or purpose between revisions';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "com_l3_template_version_guard_trigger"
  BEFORE INSERT OR UPDATE ON "CommunicationTemplateRevision"
  FOR EACH ROW EXECUTE FUNCTION "com_l3_template_version_guard"();

CREATE FUNCTION "com_l3_delivery_template_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."templateRevisionId" IS NOT NULL
    AND OLD."templateRevisionId" IS DISTINCT FROM NEW."templateRevisionId" THEN
    RAISE EXCEPTION 'frozen delivery template revision cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "com_l3_delivery_template_guard_trigger"
  BEFORE UPDATE OF "templateRevisionId" ON "MessageDelivery"
  FOR EACH ROW EXECUTE FUNCTION "com_l3_delivery_template_guard"();
