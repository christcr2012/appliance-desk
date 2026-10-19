-- K-CASH-1: additive, forward-only bank evidence and typed money source.
-- No opening amounts or live bank credentials are created by this migration.
ALTER TYPE "JournalSourceType" ADD VALUE IF NOT EXISTS 'CASH_EVENT';

CREATE TABLE "BooksPostingRevision" (
 "id" TEXT PRIMARY KEY DEFAULT 'singleton',
 "revision" BIGINT NOT NULL DEFAULT 0,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "BooksPostingRevision" ("id","revision","updatedAt")
VALUES ('singleton',0,CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "CashAccount" (
 "id" TEXT PRIMARY KEY,
 "ledgerAccountId" TEXT NOT NULL UNIQUE,
 "name" TEXT NOT NULL,
 "institutionLabel" TEXT NOT NULL,
 "lastFour" TEXT,
 "currency" TEXT NOT NULL DEFAULT 'USD',
 "active" BOOLEAN NOT NULL DEFAULT TRUE,
 "bankMatchWindowDays" INTEGER NOT NULL DEFAULT 7,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CashAccount_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CashAccount_valid" CHECK ("currency"='USD' AND "bankMatchWindowDays" BETWEEN 0 AND 30
   AND ("lastFour" IS NULL OR "lastFour" ~ '^[0-9]{4}$') AND "version">=1)
);
CREATE INDEX "CashAccount_active_idx" ON "CashAccount"("active");

CREATE TABLE "BankImport" (
 "id" TEXT PRIMARY KEY,
 "cashAccountId" TEXT NOT NULL,
 "sha256" TEXT NOT NULL,
 "mapping" JSONB NOT NULL,
 "mappingHash" TEXT NOT NULL,
 "mappingRevision" INTEGER NOT NULL DEFAULT 1,
 "rowCount" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE',
 "supersedesImportId" TEXT,
 "supersededAt" TIMESTAMP(3),
 "supersededByUserId" TEXT,
 "supersededReason" TEXT,
 "importedByUserId" TEXT NOT NULL,
 "privateEvidenceId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BankImport_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankImport_supersedesImportId_fkey" FOREIGN KEY ("supersedesImportId") REFERENCES "BankImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankImport_privateEvidenceId_fkey" FOREIGN KEY ("privateEvidenceId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankImport_state" CHECK ("status" IN ('ACTIVE','SUPERSEDED') AND "mappingRevision">=1 AND "rowCount" BETWEEN 0 AND 10000
   AND length("sha256")=64 AND length("mappingHash")=64),
 CONSTRAINT "BankImport_superseded_only" CHECK (
   ("status"='ACTIVE' AND "supersededAt" IS NULL AND "supersededByUserId" IS NULL AND "supersededReason" IS NULL)
   OR ("status"='SUPERSEDED' AND "supersededAt" IS NOT NULL AND "supersededByUserId" IS NOT NULL AND "supersededReason" IS NOT NULL))
);
CREATE UNIQUE INDEX "BankImport_cashAccountId_sha256_mappingRevision_key" ON "BankImport"("cashAccountId","sha256","mappingRevision");
CREATE UNIQUE INDEX "BankImport_one_active_sha" ON "BankImport"("cashAccountId","sha256") WHERE "status"='ACTIVE';
CREATE INDEX "BankImport_cashAccountId_status_idx" ON "BankImport"("cashAccountId","status");
CREATE INDEX "BankImport_supersedesImportId_idx" ON "BankImport"("supersedesImportId");

CREATE TABLE "BankObservation" (
 "id" TEXT PRIMARY KEY,
 "cashAccountId" TEXT NOT NULL,
 "importId" TEXT NOT NULL,
 "rowNumber" INTEGER NOT NULL,
 "postedOn" TIMESTAMP(3) NOT NULL,
 "signedCents" INTEGER NOT NULL,
 "description" TEXT NOT NULL,
 "externalId" TEXT,
 "fingerprint" TEXT NOT NULL,
 "occurrenceIndex" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
 "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
 "ignoreReason" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "BankObservation_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankObservation_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankObservation_valid" CHECK ("signedCents"<>0 AND "rowNumber">=1 AND "occurrenceIndex">=1 AND "version">=1
   AND length("description") BETWEEN 1 AND 240 AND "status" IN ('UNMATCHED','MATCHED','IGNORED','SUPERSEDED')
   AND ("status"<>'SUPERSEDED' OR "isActive"=FALSE))
);
CREATE UNIQUE INDEX "BankObservation_importId_rowNumber_key" ON "BankObservation"("importId","rowNumber");
CREATE UNIQUE INDEX "BankObservation_active_externalId" ON "BankObservation"("cashAccountId","externalId") WHERE "externalId" IS NOT NULL AND "isActive"=TRUE;
CREATE INDEX "BankObservation_cashAccountId_postedOn_idx" ON "BankObservation"("cashAccountId","postedOn");
CREATE INDEX "BankObservation_fingerprint_occurrenceIndex_idx" ON "BankObservation"("fingerprint","occurrenceIndex");
CREATE INDEX "BankObservation_importId_idx" ON "BankObservation"("importId");

CREATE TABLE "BankMatchGroup" (
 "id" TEXT PRIMARY KEY,
 "cashAccountId" TEXT NOT NULL,
 "key" TEXT NOT NULL UNIQUE,
 "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "voidedAt" TIMESTAMP(3),
 "voidedByUserId" TEXT,
 "voidedReason" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "BankMatchGroup_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankMatchGroup_void_state" CHECK ("version">=1 AND
   (("voidedAt" IS NULL AND "voidedByUserId" IS NULL AND "voidedReason" IS NULL)
     OR ("voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND "voidedReason" IS NOT NULL)))
);
CREATE INDEX "BankMatchGroup_cashAccountId_idx" ON "BankMatchGroup"("cashAccountId");

CREATE TABLE "BankMatchItem" (
 "id" TEXT PRIMARY KEY,
 "groupId" TEXT NOT NULL,
 "bankObservationId" TEXT,
 "journalLineId" TEXT,
 "signedCents" INTEGER NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT TRUE,
 CONSTRAINT "BankMatchItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BankMatchGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankMatchItem_bankObservationId_fkey" FOREIGN KEY ("bankObservationId") REFERENCES "BankObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankMatchItem_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankMatchItem_xor" CHECK ((("bankObservationId" IS NOT NULL)::integer+("journalLineId" IS NOT NULL)::integer)=1 AND "signedCents"<>0)
);
CREATE UNIQUE INDEX "BankMatchItem_active_observation" ON "BankMatchItem"("bankObservationId") WHERE "active"=TRUE AND "bankObservationId" IS NOT NULL;
CREATE UNIQUE INDEX "BankMatchItem_active_journalLine" ON "BankMatchItem"("journalLineId") WHERE "active"=TRUE AND "journalLineId" IS NOT NULL;
CREATE INDEX "BankMatchItem_groupId_idx" ON "BankMatchItem"("groupId");
CREATE INDEX "BankMatchItem_bankObservationId_idx" ON "BankMatchItem"("bankObservationId");
CREATE INDEX "BankMatchItem_journalLineId_idx" ON "BankMatchItem"("journalLineId");

CREATE TABLE "BankReconciliation" (
 "id" TEXT PRIMARY KEY,
 "cashAccountId" TEXT NOT NULL,
 "fromOn" TIMESTAMP(3) NOT NULL,
 "toOn" TIMESTAMP(3) NOT NULL,
 "beginningCents" INTEGER NOT NULL,
 "endingCents" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT',
 "revisionNo" INTEGER NOT NULL DEFAULT 1,
 "isCurrent" BOOLEAN NOT NULL DEFAULT TRUE,
 "priorCompletedId" TEXT,
 "includedEvidence" JSONB,
 "completedAt" TIMESTAMP(3),
 "completedByUserId" TEXT,
 "reopenReason" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BankReconciliation_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankReconciliation_priorCompletedId_fkey" FOREIGN KEY ("priorCompletedId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BankReconciliation_valid" CHECK ("fromOn"<="toOn" AND "revisionNo">=1 AND "version">=1
   AND "status" IN ('DRAFT','COMPLETED','REOPENED') AND ("status"<>'COMPLETED' OR
   ("completedAt" IS NOT NULL AND "completedByUserId" IS NOT NULL AND "includedEvidence" IS NOT NULL)))
);
CREATE UNIQUE INDEX "BankReconciliation_cashAccountId_fromOn_toOn_revisionNo_key" ON "BankReconciliation"("cashAccountId","fromOn","toOn","revisionNo");
CREATE UNIQUE INDEX "BankReconciliation_current" ON "BankReconciliation"("cashAccountId","fromOn","toOn") WHERE "isCurrent"=TRUE;
CREATE INDEX "BankReconciliation_cashAccountId_isCurrent_idx" ON "BankReconciliation"("cashAccountId","isCurrent");
CREATE INDEX "BankReconciliation_priorCompletedId_idx" ON "BankReconciliation"("priorCompletedId");

CREATE TABLE "CashHold" (
 "id" TEXT PRIMARY KEY,
 "cashAccountId" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL,
 "reason" TEXT NOT NULL,
 "effectiveOn" TIMESTAMP(3) NOT NULL,
 "releasedAt" TIMESTAMP(3),
 "releasedByUserId" TEXT,
 "releasedReason" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CashHold_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CashHold_valid" CHECK ("amountCents">0 AND "version">=1 AND
   (("releasedAt" IS NULL AND "releasedByUserId" IS NULL AND "releasedReason" IS NULL)
     OR ("releasedAt" IS NOT NULL AND "releasedByUserId" IS NOT NULL AND "releasedReason" IS NOT NULL)))
);
CREATE INDEX "CashHold_cashAccountId_releasedAt_idx" ON "CashHold"("cashAccountId","releasedAt");

CREATE TABLE "BookCashEvent" (
 "id" TEXT PRIMARY KEY,
 "commandKey" TEXT NOT NULL UNIQUE,
 "kind" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL,
 "occurredOn" TIMESTAMP(3) NOT NULL,
 "fromLedgerAccountId" TEXT,
 "toLedgerAccountId" TEXT,
 "sourceReceiptIds" JSONB,
 "memo" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'POSTED',
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reversalOfId" TEXT UNIQUE,
 CONSTRAINT "BookCashEvent_fromLedgerAccountId_fkey" FOREIGN KEY ("fromLedgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BookCashEvent_toLedgerAccountId_fkey" FOREIGN KEY ("toLedgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BookCashEvent_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "BookCashEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "BookCashEvent_valid" CHECK ("kind" IN ('OWNER_CONTRIBUTION','OWNER_DRAW','BANK_TRANSFER','BANK_INTEREST','CARD_PAYMENT','CASH_DEPOSIT')
   AND "amountCents">0 AND "version">=1 AND "status" IN ('POSTED','VOID'))
);
CREATE INDEX "BookCashEvent_occurredOn_kind_idx" ON "BookCashEvent"("occurredOn","kind");

CREATE TABLE "AccountingDelivery" (
 "id" TEXT PRIMARY KEY,
 "exportBatchId" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'PREPARED',
 "tenantLabel" TEXT NOT NULL,
 "edition" TEXT NOT NULL,
 "confirmedAt" TIMESTAMP(3),
 "confirmedByUserId" TEXT,
 "resolvedAt" TIMESTAMP(3),
 "resolvedByUserId" TEXT,
 "resolvedReason" TEXT,
 "replacesDeliveryId" TEXT,
 "periodKey" TEXT NOT NULL,
 "memo" TEXT,
 "privateEvidenceId" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AccountingDelivery_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "ExportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AccountingDelivery_replacesDeliveryId_fkey" FOREIGN KEY ("replacesDeliveryId") REFERENCES "AccountingDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AccountingDelivery_privateEvidenceId_fkey" FOREIGN KEY ("privateEvidenceId") REFERENCES "Photo"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AccountingDelivery_valid" CHECK ("status" IN ('PREPARED','IMPORT_CONFIRMED','FAILED_BEFORE_IMPORT','RECONCILIATION_CONFIRMED')
   AND "edition" IN ('FREE','SIMPLE_START','ESSENTIALS','PLUS','OTHER') AND "version">=1)
);
CREATE INDEX "AccountingDelivery_status_periodKey_idx" ON "AccountingDelivery"("status","periodKey");

-- Configure available source accounts only; never seed balances or initiate money movement.
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","createdAt","updatedAt")
VALUES
 ('kcash_owner_draws','OWNER_DRAWS','Owner draws','EQUITY','Distributions of actual bank funds to owners',FALSE,TRUE,91,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('kcash_interest','INTEREST_INCOME','Bank interest earned','INCOME','Actual posted bank interest, not a forecast',FALSE,TRUE,92,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("systemRole") DO NOTHING;
