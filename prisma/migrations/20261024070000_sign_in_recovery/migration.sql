-- Additive (Batch ACC, ACC-4). Wrong-password pause counters on a person, reset-link purpose on invitations, and the
-- owner's two pause numbers (starting values: 10 wrong tries inside 15 minutes, then a 15 minute wait).
ALTER TABLE "User" ADD COLUMN "failedSignInCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "failedSignInWindowStartedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "signInPausedUntil" TIMESTAMP(3);
ALTER TABLE "TeamInvitation" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'INVITE';
ALTER TABLE "TeamInvitation" ADD COLUMN "targetUserId" TEXT;
ALTER TABLE "BusinessSettings" ADD COLUMN "signInPauseAttempts" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "BusinessSettings" ADD COLUMN "signInPauseMinutes" INTEGER NOT NULL DEFAULT 15;
