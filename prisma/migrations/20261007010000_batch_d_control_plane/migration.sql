-- Batch D control plane. Additive only.
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "DocumentArtifactKind" AS ENUM ('SIGNED_AGREEMENT', 'INVOICE', 'STATEMENT');
CREATE TYPE "PrivacyRequestKind" AS ENUM ('EXPORT', 'DELETE');
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'FULFILLED', 'REJECTED');

CREATE TABLE "SiteContentRevision" (
    "id" TEXT NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "restoredFromId" TEXT,
    CONSTRAINT "SiteContentRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteContentRevision_version_key" ON "SiteContentRevision"("version");
CREATE INDEX "SiteContentRevision_status_publishedAt_idx" ON "SiteContentRevision"("status", "publishedAt");

CREATE TABLE "SiteContentPointer" (
    "id" TEXT NOT NULL DEFAULT 'published',
    "publishedRevisionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteContentPointer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentArtifact" (
    "id" TEXT NOT NULL,
    "kind" "DocumentArtifactKind" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "rendererVersion" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByUserId" TEXT,
    CONSTRAINT "DocumentArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentArtifact_kind_subjectType_subjectId_version_key" ON "DocumentArtifact"("kind", "subjectType", "subjectId", "version");
CREATE INDEX "DocumentArtifact_customerId_idx" ON "DocumentArtifact"("customerId");

CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "kind" "PrivacyRequestKind" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "customerId" TEXT,
    "requesterEmail" TEXT NOT NULL,
    "verificationTokenHash" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledByUserId" TEXT,
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrivacyRequest_status_createdAt_idx" ON "PrivacyRequest"("status", "createdAt");
CREATE INDEX "PrivacyRequest_customerId_idx" ON "PrivacyRequest"("customerId");

ALTER TABLE "BusinessSettings" ADD COLUMN "legalApprovals" JSONB NOT NULL DEFAULT '{}';
