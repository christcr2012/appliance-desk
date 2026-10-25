-- Additive (DEC-1a, Decisions & reviews). Three new tables and three new columns; nothing existing is changed or removed.

-- Provisional (researched, not yet CPA-confirmed) taxability values.
ALTER TABLE "TaxabilityRule" ADD COLUMN "provisional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "provisionalReason" TEXT,
  ADD COLUMN "provisionalSources" JSONB;

-- Append-only taxability history.
CREATE TABLE "TaxabilityRuleVersion" (
  "id" TEXT NOT NULL,
  "jurisdictionId" TEXT,
  "category" "TaxChargeCategory" NOT NULL,
  "taxability" "Taxability" NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "provisional" BOOLEAN NOT NULL DEFAULT false,
  "cpaConfirmedOn" TIMESTAMP(3),
  "reason" TEXT,
  "sources" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxabilityRuleVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaxabilityRuleVersion_jurisdictionId_category_effectiveFrom_idx"
  ON "TaxabilityRuleVersion"("jurisdictionId", "category", "effectiveFrom");

-- What was true before history existed: every current rule, from 1970-01-01.
INSERT INTO "TaxabilityRuleVersion"
  ("id", "jurisdictionId", "category", "taxability", "effectiveFrom", "provisional", "cpaConfirmedOn", "reason",
   "createdByUserId", "createdAt")
SELECT 'trv_base_' || "id", "jurisdictionId", "category", "taxability", TIMESTAMP '1970-01-01 00:00:00', false,
  "cpaConfirmedOn", "reason", "updatedByUserId", CURRENT_TIMESTAMP
FROM "TaxabilityRule";

-- Decisions & reviews evidence (append-only).
CREATE TABLE "DecisionRecord" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "value" JSONB,
  "previousValue" JSONB,
  "effectiveFrom" TIMESTAMP(3),
  "answeredByUserId" TEXT,
  "professionalName" TEXT,
  "professionalFirm" TEXT,
  "professionalAnsweredOn" TIMESTAMP(3),
  "explanation" TEXT,
  "attachmentUrl" TEXT,
  "sources" JSONB,
  "via" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DecisionRecord_subjectId_createdAt_idx" ON "DecisionRecord"("subjectId", "createdAt");
CREATE INDEX "DecisionRecord_audience_createdAt_idx" ON "DecisionRecord"("audience", "createdAt");
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_answeredByUserId_fkey"
  FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Decisions that start on a later date.
CREATE TABLE "DecisionScheduledChange" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "decisionRecordId" TEXT NOT NULL,
  "provisional" BOOLEAN NOT NULL DEFAULT false,
  "appliedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionScheduledChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DecisionScheduledChange_appliedAt_effectiveFrom_idx" ON "DecisionScheduledChange"("appliedAt", "effectiveFrom");
CREATE INDEX "DecisionScheduledChange_subjectId_effectiveFrom_idx" ON "DecisionScheduledChange"("subjectId", "effectiveFrom");
-- One waiting change per subject, so a double click cannot stack two.
CREATE UNIQUE INDEX "DecisionScheduledChange_one_pending_per_subject"
  ON "DecisionScheduledChange"("subjectId") WHERE "appliedAt" IS NULL AND "cancelledAt" IS NULL;
