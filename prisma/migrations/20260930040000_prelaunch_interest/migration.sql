-- Additive only. Existing quote/customer/rental records are unchanged.
CREATE TABLE "LaunchSettings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "prelaunchMode" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "postalAddress" TEXT NOT NULL DEFAULT '',
  "replyToEmail" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LaunchSettings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LaunchSubscriber" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "interest" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'website',
  "consentVersion" TEXT NOT NULL,
  "consentText" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unsubscribeToken" TEXT NOT NULL,
  "unsubscribedAt" TIMESTAMP(3),
  "nextStep" INTEGER NOT NULL DEFAULT 0,
  "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryBlocked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LaunchSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LaunchSubscriber_email_key" ON "LaunchSubscriber"("email");
CREATE UNIQUE INDEX "LaunchSubscriber_unsubscribeToken_key" ON "LaunchSubscriber"("unsubscribeToken");
CREATE INDEX "LaunchSubscriber_unsubscribedAt_deliveryBlocked_nextSendAt_idx" ON "LaunchSubscriber"("unsubscribedAt", "deliveryBlocked", "nextSendAt");
CREATE TABLE "LaunchDelivery" (
  "id" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENDING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "LaunchDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LaunchDelivery_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "LaunchSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LaunchDelivery_subscriberId_step_key" ON "LaunchDelivery"("subscriberId", "step");
