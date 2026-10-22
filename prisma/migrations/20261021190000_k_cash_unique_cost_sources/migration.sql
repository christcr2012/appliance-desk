-- Linked recurring, purchasing and provider evidence is one obligation source.
-- Inactive source plans keep provenance; relink by revising the original record.
-- Manual plans (sourceId NULL) retain multiple independent owner-created costs.
CREATE UNIQUE INDEX "BudgetCostPlan_verified_source_once"
 ON "BudgetCostPlan" ("sourceType","sourceId")
 WHERE "sourceType" <> 'MANUAL' AND "sourceId" IS NOT NULL;
