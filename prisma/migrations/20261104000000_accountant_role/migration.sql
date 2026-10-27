-- ACCT-1: the ACCOUNTANT access level and the fields that carry it.
-- Additive only: a new enum value, new nullable columns, and two columns with defaults.
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';
ALTER TYPE "JournalSourceType" ADD VALUE 'ADJUSTMENT';

ALTER TABLE "User" ADD COLUMN "firm" TEXT;
ALTER TABLE "User" ADD COLUMN "accessEndsOn" TIMESTAMP(3);

ALTER TABLE "TeamInvitation" ADD COLUMN "firm" TEXT;
ALTER TABLE "TeamInvitation" ADD COLUMN "accessEndsOn" TIMESTAMP(3);

ALTER TABLE "BusinessPaperwork" ADD COLUMN "shareWithAccountant" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BusinessSettings" ADD COLUMN "accountantChangesSeenAt" TIMESTAMP(3);

ALTER TABLE "ComplianceFiling" ADD COLUMN "reviewedByUserId" TEXT;
ALTER TABLE "ComplianceFiling" ADD COLUMN "reviewedAt" TIMESTAMP(3);
