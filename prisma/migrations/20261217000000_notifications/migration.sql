-- AR-13: in-app notifications bell (docs/build-specs/engines/NOTIFICATIONS.md section 2). Additive only.
-- The spec named this migration 20261031000000_notifications; the repo's migrations are future-dated
-- (latest 20261210000000), so it takes the next conventional future date instead.
CREATE TYPE "NotificationKind" AS ENUM ('LEAD_NEW', 'QUOTE_VIEWED', 'SIGNATURE_DONE', 'PAYMENT_FAILED', 'APPROVAL_REQUESTED');
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "kind" "NotificationKind" NOT NULL,
  "title" VARCHAR(160) NOT NULL, "body" VARCHAR(300) NOT NULL, "href" VARCHAR(400) NOT NULL,
  "entityType" VARCHAR(40) NOT NULL, "entityId" TEXT NOT NULL, "dedupeKey" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL, "kind" "NotificationKind" NOT NULL,
  "inApp" BOOLEAN NOT NULL DEFAULT true, "email" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "kind")
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessSettings" ADD COLUMN "notificationKeepDays" INTEGER NOT NULL DEFAULT 90;
