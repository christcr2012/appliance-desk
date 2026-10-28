ALTER TABLE "AgentOperation" ADD COLUMN "connectionGrantVersion" TEXT;
ALTER TABLE "AgentOperation" ADD COLUMN "lastReconciledAt" TIMESTAMP(3);
ALTER TABLE "DecisionRecord" ADD COLUMN "agentOperationId" TEXT;
CREATE INDEX "DecisionRecord_agentOperationId_subjectId_idx" ON "DecisionRecord"("agentOperationId", "subjectId");
