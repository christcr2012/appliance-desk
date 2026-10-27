-- VAULT-2 review fix: when the "emergency access was requested" warning to
-- the owner could not be delivered on any channel, stamp the request so the
-- failure is visible on the owner's vault page and the daily sweep retries
-- it. Cleared by the first successful (re)delivery.

-- AlterTable
ALTER TABLE "EmergencyAccessRequest" ADD COLUMN "startNoticeFailedAt" TIMESTAMP(3);
