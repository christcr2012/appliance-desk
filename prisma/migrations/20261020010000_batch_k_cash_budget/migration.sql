-- K-CASH-4A additive budget schema. Zero money allocated on migration; cashBudgetEnabled OFF.
ALTER TABLE "BusinessSettings"
 ADD COLUMN "cashBudgetStartOn" TIMESTAMP(3),
 ADD COLUMN "cashBudgetEnabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "bankEvidenceMaxAgeDays" INTEGER NOT NULL DEFAULT 7,
 ADD COLUMN "budgetPlanningHorizonDays" INTEGER NOT NULL DEFAULT 90,
 ADD COLUMN "budgetUpcomingWindowDays" INTEGER NOT NULL DEFAULT 30,
 ADD COLUMN "budgetReminderLeadDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "CashBudget_settings_range" CHECK (
 "bankEvidenceMaxAgeDays" BETWEEN 1 AND 90 AND
 "budgetPlanningHorizonDays" BETWEEN 30 AND 365 AND
 "budgetUpcomingWindowDays" BETWEEN 1 AND 90 AND
 "budgetReminderLeadDays" BETWEEN 0 AND 90
);

CREATE TABLE "BudgetState" (
 "readinessAttestation" JSONB,
 "id" TEXT NOT NULL DEFAULT 'singleton', "revision" BIGINT NOT NULL DEFAULT 1,
 "startOn" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BudgetState_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetState_singleton" CHECK ("id"='singleton' AND "revision">0)
);
INSERT INTO "BudgetState" ("id","revision") VALUES ('singleton',1);

CREATE TABLE "BudgetEnvelope" (
 "id" TEXT NOT NULL, "name" TEXT NOT NULL,
 "groupLabel" TEXT NOT NULL DEFAULT 'Discretionary',
 "sortOrder" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT true,
 "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BudgetEnvelope_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetEnvelope_label_valid" CHECK (
  length(btrim("name")) BETWEEN 1 AND 120 AND
  length(btrim("groupLabel")) BETWEEN 1 AND 120 AND "version">0)
);
CREATE INDEX "BudgetEnvelope_active_sortOrder_idx" ON "BudgetEnvelope" ("active","sortOrder");
INSERT INTO "BudgetEnvelope" ("id","name","sortOrder") VALUES
 ('budget-default-operating','Operating costs',0),
 ('budget-default-repairs','Repairs and parts',1),
 ('budget-default-appliances','Appliance purchases/replacement',2),
 ('budget-default-annual','Annual fees and insurance',3),
 ('budget-default-income-tax','Income-tax planning',4),
 ('budget-default-owner','Owner pay',5),
 ('budget-default-emergency','Emergency cushion',6);

CREATE TABLE "BudgetMove" (
 "id" TEXT NOT NULL, "commandKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "resultRevision" BIGINT,
 "envelopeId" TEXT NOT NULL, "signedCents" INTEGER NOT NULL, "kind" TEXT NOT NULL,
 "sourceType" TEXT, "sourceId" TEXT, "eventKind" TEXT, "reason" TEXT NOT NULL,
 "actorId" TEXT, "reversalOfId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BudgetMove_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetMove_amount_kind" CHECK (
 ("kind" IN ('ASSIGN','REFUND') AND "signedCents">0) OR
 ("kind" IN ('RELEASE','SPEND') AND "signedCents"<0) OR
 ("kind"='REVERSAL' AND "signedCents"<>0)),
 CONSTRAINT "BudgetMove_source_shape" CHECK (("kind" IN ('ASSIGN','RELEASE')) OR
  ("sourceType" IS NOT NULL AND "sourceId" IS NOT NULL AND "eventKind" IS NOT NULL))
);
CREATE UNIQUE INDEX "BudgetMove_commandKey_envelopeId_kind_key" ON "BudgetMove" ("commandKey","envelopeId","kind");
CREATE UNIQUE INDEX "BudgetMove_reversalOfId_key" ON "BudgetMove" ("reversalOfId");
CREATE UNIQUE INDEX "BudgetMove_source_active_once" ON "BudgetMove" ("sourceType","sourceId","eventKind","envelopeId","kind")
 WHERE "kind" IN ('SPEND','REVERSAL','REFUND') AND "sourceType" IS NOT NULL;
CREATE INDEX "BudgetMove_envelopeId_createdAt_idx" ON "BudgetMove" ("envelopeId","createdAt");
CREATE INDEX "BudgetMove_sourceType_sourceId_eventKind_idx" ON "BudgetMove" ("sourceType","sourceId","eventKind");
CREATE INDEX "BudgetMove_actorId_idx" ON "BudgetMove" ("actorId");
ALTER TABLE "BudgetMove" ADD CONSTRAINT "BudgetMove_envelopeId_fkey"
 FOREIGN KEY ("envelopeId") REFERENCES "BudgetEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetMove" ADD CONSTRAINT "BudgetMove_actorId_fkey"
 FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetMove" ADD CONSTRAINT "BudgetMove_reversalOfId_fkey"
 FOREIGN KEY ("reversalOfId") REFERENCES "BudgetMove"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetSpendSplit" (
 "id" TEXT NOT NULL, "journalLineId" TEXT NOT NULL, "envelopeId" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "BudgetSpendSplit_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetSpendSplit_valid" CHECK ("amountCents">0 AND "version">0)
);
CREATE UNIQUE INDEX "BudgetSpendSplit_journalLineId_envelopeId_key" ON "BudgetSpendSplit" ("journalLineId","envelopeId");
CREATE INDEX "BudgetSpendSplit_envelopeId_idx" ON "BudgetSpendSplit" ("envelopeId");
ALTER TABLE "BudgetSpendSplit" ADD CONSTRAINT "BudgetSpendSplit_journalLineId_fkey"
 FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetSpendSplit" ADD CONSTRAINT "BudgetSpendSplit_envelopeId_fkey"
 FOREIGN KEY ("envelopeId") REFERENCES "BudgetEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetTarget" (
 "id" TEXT NOT NULL, "envelopeId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL, "dueOn" TIMESTAMP(3), "repeat" TEXT NOT NULL DEFAULT 'NONE',
 "active" BOOLEAN NOT NULL DEFAULT true, "cycleStartOn" TIMESTAMP(3),
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BudgetTarget_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetTarget_valid" CHECK ("kind" IN ('MONTHLY_SPEND','SAVE_BY_DATE','MAINTAIN_BALANCE')
 AND "amountCents">0 AND "repeat" IN ('NONE','ANNUAL') AND "version">0)
);
CREATE UNIQUE INDEX "BudgetTarget_envelopeId_key" ON "BudgetTarget" ("envelopeId");
ALTER TABLE "BudgetTarget" ADD CONSTRAINT "BudgetTarget_envelopeId_fkey"
 FOREIGN KEY ("envelopeId") REFERENCES "BudgetEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetCostPlan" (
 "id" TEXT NOT NULL, "envelopeId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL, "amountQuality" TEXT NOT NULL, "dueOn" TIMESTAMP(3) NOT NULL,
 "recurrence" TEXT NOT NULL DEFAULT 'NONE', "anchorDay" INTEGER NOT NULL,
 "anchorMonth" INTEGER, "sourceType" TEXT NOT NULL DEFAULT 'MANUAL', "sourceId" TEXT,
 "active" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BudgetCostPlan_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetCostPlan_valid" CHECK (
  length(btrim("name")) BETWEEN 1 AND 200 AND "amountCents">0 AND
  "amountQuality" IN ('EXACT','ESTIMATE') AND
  "recurrence" IN ('NONE','MONTHLY','QUARTERLY','ANNUAL') AND
  "anchorDay" BETWEEN 1 AND 31 AND ("anchorMonth" IS NULL OR "anchorMonth" BETWEEN 1 AND 12) AND
  "sourceType" IN ('MANUAL','RECURRING_EXPENSE','PURCHASE_ORDER','TAX_FILING','TELECOM_PLAN') AND
  ("sourceType"='MANUAL' OR "sourceId" IS NOT NULL) AND "version">0)
);
CREATE INDEX "BudgetCostPlan_envelopeId_active_idx" ON "BudgetCostPlan" ("envelopeId","active");
CREATE INDEX "BudgetCostPlan_dueOn_idx" ON "BudgetCostPlan" ("dueOn");
CREATE INDEX "BudgetCostPlan_sourceType_sourceId_idx" ON "BudgetCostPlan" ("sourceType","sourceId");
CREATE UNIQUE INDEX "BudgetCostPlan_source_once" ON "BudgetCostPlan" ("sourceType","sourceId") WHERE "sourceId" IS NOT NULL;
ALTER TABLE "BudgetCostPlan" ADD CONSTRAINT "BudgetCostPlan_envelopeId_fkey"
 FOREIGN KEY ("envelopeId") REFERENCES "BudgetEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetCostOccurrence" (
 "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "dueOn" TIMESTAMP(3) NOT NULL,
 "amountCents" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'PLANNED',
 "sourceRevision" INTEGER NOT NULL DEFAULT 1, "version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "BudgetCostOccurrence_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetCostOccurrence_valid" CHECK ("amountCents">0 AND
 "status" IN ('PLANNED','PART_PAID','PAID','CANCELLED') AND "sourceRevision">0 AND "version">0)
);
CREATE UNIQUE INDEX "BudgetCostOccurrence_planId_dueOn_key" ON "BudgetCostOccurrence" ("planId","dueOn");
CREATE INDEX "BudgetCostOccurrence_status_dueOn_idx" ON "BudgetCostOccurrence" ("status","dueOn");
ALTER TABLE "BudgetCostOccurrence" ADD CONSTRAINT "BudgetCostOccurrence_planId_fkey"
 FOREIGN KEY ("planId") REFERENCES "BudgetCostPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetCostSettlement" (
 "id" TEXT NOT NULL, "occurrenceId" TEXT NOT NULL, "sourceType" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL, "amountCents" INTEGER NOT NULL, "commandKey" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL, "reversalOfId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BudgetCostSettlement_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BudgetCostSettlement_valid" CHECK ("amountCents">0 AND length(btrim("sourceId"))>0)
);
CREATE UNIQUE INDEX "BudgetCostSettlement_commandKey_key" ON "BudgetCostSettlement" ("commandKey");
CREATE UNIQUE INDEX "BudgetCostSettlement_reversalOfId_key" ON "BudgetCostSettlement" ("reversalOfId");
CREATE UNIQUE INDEX "BudgetCostSettlement_source_original_once" ON "BudgetCostSettlement" ("occurrenceId","sourceType","sourceId") WHERE "reversalOfId" IS NULL;
CREATE INDEX "BudgetCostSettlement_occurrenceId_idx" ON "BudgetCostSettlement" ("occurrenceId");
CREATE INDEX "BudgetCostSettlement_sourceType_sourceId_idx" ON "BudgetCostSettlement" ("sourceType","sourceId");
ALTER TABLE "BudgetCostSettlement" ADD CONSTRAINT "BudgetCostSettlement_occurrenceId_fkey"
 FOREIGN KEY ("occurrenceId") REFERENCES "BudgetCostOccurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetCostSettlement" ADD CONSTRAINT "BudgetCostSettlement_reversalOfId_fkey"
 FOREIGN KEY ("reversalOfId") REFERENCES "BudgetCostSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
