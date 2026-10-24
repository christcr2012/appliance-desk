-- Additive (Batch ACC, ACC-2). Team invitations (not logins) and two owner settings. Nothing existing changes.
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "accessLevel" "Role" NOT NULL DEFAULT 'STAFF',
    "adminCapabilityLimits" JSONB NOT NULL DEFAULT '[]',
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "invitedById" TEXT NOT NULL,
    "acceptedUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamInvitation_codeHash_key" ON "TeamInvitation"("codeHash");
CREATE INDEX "TeamInvitation_email_idx" ON "TeamInvitation"("email");
CREATE INDEX "TeamInvitation_status_expiresAt_idx" ON "TeamInvitation"("status", "expiresAt");
ALTER TABLE "BusinessSettings" ADD COLUMN "invitationLinkDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "BusinessSettings" ADD COLUMN "adminsMayInviteStaff" BOOLEAN NOT NULL DEFAULT false;
