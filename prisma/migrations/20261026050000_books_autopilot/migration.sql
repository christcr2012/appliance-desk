-- BA-1: additional books automation evidence; journals and existing records are unchanged.
ALTER TABLE "BookAsset"
  ALTER COLUMN "createdByUserId" DROP NOT NULL,
  ADD COLUMN "enrollmentSource" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "fullyDepreciatedOn" TIMESTAMP(3),
  ADD COLUMN "disposalCycle" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BusinessSettings"
  ADD COLUMN "booksLastBroughtUpToDateAt" TIMESTAMP(3),
  ADD COLUMN "booksLastProblemCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "booksConsecutiveFailedNights" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "BooksProblem" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "BooksProblem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BooksProblem_kind_subjectType_subjectId_key"
 ON "BooksProblem"("kind", "subjectType", "subjectId");
CREATE INDEX "BooksProblem_resolvedAt_kind_idx" ON "BooksProblem"("resolvedAt", "kind");
