-- MCP-8: bounded, non-personal timing samples and review-only optimization proposals.
CREATE TABLE "PerfSample" (
  "id" TEXT NOT NULL,
  "kind" VARCHAR(10) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "ms" INTEGER NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PerfSample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PerfSample_kind_check" CHECK ("kind" IN ('PAGE','ACTION','JOB','QUERY')),
  CONSTRAINT "PerfSample_ms_check" CHECK ("ms" >= 0 AND "ms" <= 3600000)
);
CREATE INDEX "PerfSample_kind_name_at_idx" ON "PerfSample"("kind","name","at");
CREATE INDEX "PerfSample_at_idx" ON "PerfSample"("at");

CREATE TABLE "OptimizationProposal" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "observationRefs" JSONB NOT NULL,
  "expectedBenefit" VARCHAR(2000) NOT NULL,
  "risk" VARCHAR(2000) NOT NULL,
  "costNote" VARCHAR(500) NOT NULL,
  "measurementPlan" VARCHAR(2000) NOT NULL,
  "rollback" VARCHAR(2000) NOT NULL,
  "state" VARCHAR(15) NOT NULL DEFAULT 'PROPOSED',
  "createdByUserId" TEXT NOT NULL,
  "repairCaseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OptimizationProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OptimizationProposal_number_key" UNIQUE ("number"),
  CONSTRAINT "OptimizationProposal_state_check" CHECK ("state" IN ('PROPOSED','ACCEPTED','REJECTED','DONE'))
);
CREATE INDEX "OptimizationProposal_state_createdAt_idx" ON "OptimizationProposal"("state","createdAt");
