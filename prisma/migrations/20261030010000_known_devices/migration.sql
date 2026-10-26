-- Additive (ACC-6, remember this device). One new table and one new column; nothing existing is changed or removed.
--
-- KnownDevice records the devices a person has signed in from, keyed by a device cookie. The cookie value itself
-- is never stored, only its SHA-256 hash, and the cookie never signs anyone in on its own. The "new device" notice
-- keys on this table now (a second phone of the same kind is new). trustedUntil is set when the person ticks
-- "Remember this device" and is never extended by later sign-ins. BusinessSettings.trustedDeviceDays is the owner's
-- "remember devices for this many days" setting (0-90; 0 = always ask), starting at 30.

CREATE TABLE "KnownDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceHash" CHAR(64) NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trustedUntil" TIMESTAMP(3),
  "forgottenAt" TIMESTAMP(3),
  CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KnownDevice_userId_deviceHash_key" ON "KnownDevice"("userId", "deviceHash");
CREATE INDEX "KnownDevice_userId_lastSeenAt_idx" ON "KnownDevice"("userId", "lastSeenAt");
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessSettings" ADD COLUMN "trustedDeviceDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_trustedDeviceDays_check"
  CHECK ("trustedDeviceDays" BETWEEN 0 AND 90);
