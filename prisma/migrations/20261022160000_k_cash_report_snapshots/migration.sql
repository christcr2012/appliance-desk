-- K-CASH-7: additive, zero-data migration. No financial source or payment mutates.
CREATE TABLE "BudgetPlanVersion" (
 "id" TEXT NOT NULL,
 "monthKey" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "commandKey" TEXT NOT NULL,
 "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "publishedByUserId" TEXT NOT NULL,
 "sourceRevision" BIGINT NOT NULL,
 "budgetRevision" BIGINT NOT NULL,
 "schemaVersion" INTEGER NOT NULL DEFAULT 1,
 "payload" JSONB NOT NULL,
 "sha256" TEXT NOT NULL,
 "note" TEXT NOT NULL,
 "supersedesId" TEXT,
 CONSTRAINT "BudgetPlanVersion_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetPlanVersion_version_check" CHECK ("version" > 0),
 CONSTRAINT "BudgetPlanVersion_month_check" CHECK ("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 CONSTRAINT "BudgetPlanVersion_sha_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "BudgetPlanVersion_schema_check" CHECK ("schemaVersion" = 1)
);
CREATE UNIQUE INDEX "BudgetPlanVersion_commandKey_key" ON "BudgetPlanVersion"("commandKey");
CREATE UNIQUE INDEX "BudgetPlanVersion_monthKey_version_key" ON "BudgetPlanVersion"("monthKey","version");
CREATE UNIQUE INDEX "BudgetPlanVersion_supersedesId_key" ON "BudgetPlanVersion"("supersedesId");
CREATE INDEX "BudgetPlanVersion_monthKey_publishedAt_idx" ON "BudgetPlanVersion"("monthKey","publishedAt");
ALTER TABLE "BudgetPlanVersion"
 ADD CONSTRAINT "BudgetPlanVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetPlanVersion"
 ADD CONSTRAINT "BudgetPlanVersion_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "BudgetPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetReviewSnapshot" (
 "id" TEXT NOT NULL,
 "commandKey" TEXT NOT NULL,
 "monthKey" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdByUserId" TEXT NOT NULL,
 "sourceRevision" BIGINT NOT NULL,
 "budgetRevision" BIGINT NOT NULL,
 "schemaVersion" INTEGER NOT NULL DEFAULT 1,
 "payload" JSONB NOT NULL,
 "sha256" TEXT NOT NULL,
 CONSTRAINT "BudgetReviewSnapshot_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetReviewSnapshot_month_check" CHECK ("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 CONSTRAINT "BudgetReviewSnapshot_sha_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "BudgetReviewSnapshot_schema_check" CHECK ("schemaVersion" = 1)
);
CREATE UNIQUE INDEX "BudgetReviewSnapshot_commandKey_key" ON "BudgetReviewSnapshot"("commandKey");
CREATE INDEX "BudgetReviewSnapshot_monthKey_createdAt_idx" ON "BudgetReviewSnapshot"("monthKey","createdAt");
ALTER TABLE "BudgetReviewSnapshot"
 ADD CONSTRAINT "BudgetReviewSnapshot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Even an accidental future code path or raw SQL may not rewrite a certified
-- historical plan or month-end report. Restrict DELETE as well as UPDATE;
-- backup/restore uses inserts into a fresh schema in original source order.
CREATE FUNCTION "reject_budget_published_history_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Published budget and month-end reports are immutable';
END; $$;
CREATE TRIGGER "BudgetPlanVersion_immutable" BEFORE UPDATE OR DELETE ON "BudgetPlanVersion"
 FOR EACH ROW EXECUTE FUNCTION "reject_budget_published_history_mutation"();
CREATE TRIGGER "BudgetReviewSnapshot_immutable" BEFORE UPDATE OR DELETE ON "BudgetReviewSnapshot"
 FOR EACH ROW EXECUTE FUNCTION "reject_budget_published_history_mutation"();
