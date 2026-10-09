-- CreateEnum
CREATE TYPE "TelecomEnvironment" AS ENUM ('PRODUCTION', 'TEST');

-- CreateEnum
CREATE TYPE "TelecomAccountStatus" AS ENUM ('UNCONFIGURED', 'READY', 'DEGRADED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TelecomRegistrationStatus" AS ENUM ('UNKNOWN', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContactSuppressionState" AS ENUM ('NONE', 'OPTED_OUT', 'REVIEW');

-- CreateEnum
CREATE TYPE "ContactBindingSource" AS ENUM ('LEGACY', 'SELF_SERVICE', 'INBOUND', 'STAFF');

-- CreateEnum
CREATE TYPE "CommunicationConsentPurpose" AS ENUM ('SMS_TRANSACTIONAL', 'SMS_MARKETING', 'SMS_CONVERSATIONAL');

-- CreateEnum
CREATE TYPE "CommunicationConsentAction" AS ENUM ('GRANT', 'REVOKE', 'PROVIDER_REENABLE', 'HELP');

-- CreateEnum
CREATE TYPE "CommunicationConsentSource" AS ENUM ('PORTAL', 'WEB_FORM', 'SIGNED_DISCLOSURE', 'INBOUND_EXCHANGE', 'PROVIDER_KEYWORD', 'STAFF_EVIDENCE');

-- CreateEnum
CREATE TYPE "MessageAttemptState" AS ENUM ('PREPARED', 'DISPATCHING', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'NOT_SENT');

-- CreateEnum
CREATE TYPE "ProviderEventDisposition" AS ENUM ('RECEIVED', 'PENDING_MATCH', 'APPLIED', 'IGNORED', 'FAILED', 'LEGACY_HANDLED');

-- CreateEnum
CREATE TYPE "CommunicationOrigin" AS ENUM ('AUTOMATION', 'MANUAL');

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "communicationsPolicy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "communicationsPolicyVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ConsentRecord" ADD COLUMN     "action" "CommunicationConsentAction",
ADD COLUMN     "contactPointId" TEXT,
ADD COLUMN     "disclosureVersion" TEXT,
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMP(3),
ADD COLUMN     "purpose" "CommunicationConsentPurpose",
ADD COLUMN     "scope" JSONB,
ADD COLUMN     "source" "CommunicationConsentSource",
ADD COLUMN     "textHash" TEXT;

-- AlterTable
ALTER TABLE "MessageDelivery" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "currentAttemptId" TEXT,
ADD COLUMN     "environment" "TelecomEnvironment",
ADD COLUMN     "origin" "CommunicationOrigin",
ADD COLUMN     "renderedBody" TEXT,
ADD COLUMN     "renderedSubject" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "telecomAccountId" TEXT;

-- AlterTable
ALTER TABLE "ProviderEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disposition" "ProviderEventDisposition" NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN     "environment" "TelecomEnvironment",
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "responseStepKey" TEXT,
ADD COLUMN     "responseXmlEncrypted" TEXT,
ADD COLUMN     "telecomAccountId" TEXT;

-- CreateTable
CREATE TABLE "TelecomAccount" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" "TelecomEnvironment" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "TelecomAccountStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "checkedAt" TIMESTAMP(3),
    "readiness" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelecomAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPhoneNumber" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "providerNumberId" TEXT NOT NULL,
    "messagingServiceId" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "registrationStatus" "TelecomRegistrationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessPhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" TEXT NOT NULL,
    "environment" "TelecomEnvironment" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "suppressionState" "ContactSuppressionState" NOT NULL DEFAULT 'NONE',
    "suppressionVersion" INTEGER NOT NULL DEFAULT 0,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactBinding" (
    "id" TEXT NOT NULL,
    "contactPointId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "customerContactId" TEXT,
    "source" "ContactBindingSource" NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "accountId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "operationKey" TEXT NOT NULL,
    "state" "MessageAttemptState" NOT NULL DEFAULT 'PREPARED',
    "providerResourceId" TEXT,
    "requestHash" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelecomAccount_provider_environment_externalAccountId_key" ON "TelecomAccount"("provider", "environment", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPhoneNumber_accountId_address_key" ON "BusinessPhoneNumber"("accountId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPhoneNumber_accountId_providerNumberId_key" ON "BusinessPhoneNumber"("accountId", "providerNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPoint_environment_channel_address_key" ON "ContactPoint"("environment", "channel", "address");

-- CreateIndex
CREATE INDEX "ContactBinding_customerId_idx" ON "ContactBinding"("customerId");

-- CreateIndex
CREATE INDEX "ContactBinding_leadId_idx" ON "ContactBinding"("leadId");

-- CreateIndex
CREATE INDEX "ContactBinding_customerContactId_idx" ON "ContactBinding"("customerContactId");

-- CreateIndex
CREATE INDEX "ContactBinding_contactPointId_revokedAt_idx" ON "ContactBinding"("contactPointId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_operationKey_key" ON "MessageAttempt"("operationKey");

-- CreateIndex
CREATE INDEX "MessageAttempt_state_startedAt_idx" ON "MessageAttempt"("state", "startedAt");

-- CreateIndex
CREATE INDEX "MessageAttempt_deliveryId_idx" ON "MessageAttempt"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_deliveryId_attemptNumber_key" ON "MessageAttempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_accountId_providerResourceId_key" ON "MessageAttempt"("accountId", "providerResourceId");

-- CreateIndex
CREATE INDEX "ConsentRecord_contactPointId_purpose_occurredAt_id_idx" ON "ConsentRecord"("contactPointId", "purpose", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_currentAttemptId_key" ON "MessageDelivery"("currentAttemptId");

-- CreateIndex
CREATE INDEX "ProviderEvent_disposition_nextAttemptAt_idx" ON "ProviderEvent"("disposition", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_telecomAccountId_receivedAt_idx" ON "ProviderEvent"("telecomAccountId", "receivedAt");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_telecomAccountId_fkey" FOREIGN KEY ("telecomAccountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_currentAttemptId_fkey" FOREIGN KEY ("currentAttemptId") REFERENCES "MessageAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_telecomAccountId_fkey" FOREIGN KEY ("telecomAccountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPhoneNumber" ADD CONSTRAINT "BusinessPhoneNumber_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBinding" ADD CONSTRAINT "ContactBinding_contactPointId_fkey" FOREIGN KEY ("contactPointId") REFERENCES "ContactPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBinding" ADD CONSTRAINT "ContactBinding_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBinding" ADD CONSTRAINT "ContactBinding_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBinding" ADD CONSTRAINT "ContactBinding_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "CustomerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "MessageDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Legacy callbacks previously used only processedAt. Never infer that any
-- processed row represents a successful application: some were ignored.
UPDATE "ProviderEvent"
SET "disposition" = 'LEGACY_HANDLED'::"ProviderEventDisposition"
WHERE "processedAt" IS NOT NULL;

ALTER TABLE "ContactBinding" ADD CONSTRAINT "ContactBinding_one_subject_check"
  CHECK (num_nonnulls("customerId", "leadId", "customerContactId") = 1);

CREATE UNIQUE INDEX "ContactBinding_current_customer_key"
  ON "ContactBinding"("contactPointId", "customerId")
  WHERE "revokedAt" IS NULL AND "customerId" IS NOT NULL;
CREATE UNIQUE INDEX "ContactBinding_current_lead_key"
  ON "ContactBinding"("contactPointId", "leadId")
  WHERE "revokedAt" IS NULL AND "leadId" IS NOT NULL;
CREATE UNIQUE INDEX "ContactBinding_current_customer_contact_key"
  ON "ContactBinding"("contactPointId", "customerContactId")
  WHERE "revokedAt" IS NULL AND "customerContactId" IS NOT NULL;

CREATE UNIQUE INDEX "BusinessPhoneNumber_current_primary_key"
  ON "BusinessPhoneNumber"("accountId")
  WHERE "isPrimary" AND "retiredAt" IS NULL;

ALTER TABLE "MessageAttempt"
  ADD CONSTRAINT "MessageAttempt_positive_sequence_check" CHECK ("attemptNumber" > 0);
ALTER TABLE "ProviderEvent"
  ADD CONSTRAINT "ProviderEvent_nonnegative_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "ContactPoint"
  ADD CONSTRAINT "ContactPoint_nonnegative_suppression_check" CHECK ("suppressionVersion" >= 0),
  ADD CONSTRAINT "ContactPoint_sms_only_check" CHECK ("channel" = 'SMS');
ALTER TABLE "BusinessSettings"
  ADD CONSTRAINT "BusinessSettings_positive_policy_version_check"
  CHECK ("communicationsPolicyVersion" > 0);
