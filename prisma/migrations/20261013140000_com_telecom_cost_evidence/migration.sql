-- CreateEnum
CREATE TYPE "TelecomSyncResource" AS ENUM ('MESSAGES', 'CALLS', 'USAGE', 'PRICING', 'READINESS');

-- CreateEnum
CREATE TYPE "TelecomCostClassification" AS ENUM ('ESTIMATED', 'PROVIDER_REPORTED', 'INVOICE_RECONCILED');

-- CreateEnum
CREATE TYPE "TelecomRateSource" AS ENUM ('PRICING_API', 'OWNER_VERIFIED');

-- CreateEnum
CREATE TYPE "TelecomStatementState" AS ENUM ('DRAFT', 'VERIFIED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "TelecomSyncCursor" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "resource" "TelecomSyncResource" NOT NULL,
    "nextPageToken" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "completedThrough" TIMESTAMP(3),
    "claimToken" TEXT,
    "claimUntil" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelecomSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomUsageSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "count" DECIMAL(24,10) NOT NULL,
    "countUnit" TEXT NOT NULL,
    "usage" DECIMAL(24,10) NOT NULL,
    "usageUnit" TEXT NOT NULL,
    "price" DECIMAL(24,10),
    "currency" TEXT NOT NULL,
    "providerAsOf" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isTotal" BOOLEAN NOT NULL DEFAULT false,
    "payloadHash" TEXT NOT NULL,
    "providerSource" TEXT NOT NULL,

    CONSTRAINT "TelecomUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationCostFact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessNumberId" TEXT,
    "messageAttemptId" TEXT,
    "callLegId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "classification" "TelecomCostClassification" NOT NULL,
    "amount" DECIMAL(24,10) NOT NULL,
    "currency" TEXT NOT NULL,
    "quantity" DECIMAL(24,10),
    "unit" TEXT,
    "rateVersionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "providerAsOf" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" TEXT,
    "statementId" TEXT,

    CONSTRAINT "CommunicationCostFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomRateVersion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "destinationCountry" TEXT,
    "destinationPrefix" TEXT,
    "destinationKey" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "currency" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "source" "TelecomRateSource" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "completeness" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "TelecomRateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelecomStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "invoiceTotalCents" INTEGER NOT NULL,
    "issueDate" DATE NOT NULL,
    "privateEvidenceStorageKey" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "state" "TelecomStatementState" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "paidOn" DATE,
    "vendorTaxCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelecomStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelecomSyncCursor_claimUntil_idx" ON "TelecomSyncCursor"("claimUntil");

-- CreateIndex
CREATE UNIQUE INDEX "TelecomSyncCursor_accountId_resource_key" ON "TelecomSyncCursor"("accountId", "resource");

-- CreateIndex
CREATE INDEX "TelecomUsageSnapshot_accountId_startDate_endDate_idx" ON "TelecomUsageSnapshot"("accountId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "TelecomUsageSnapshot_accountId_category_startDate_endDate_p_key" ON "TelecomUsageSnapshot"("accountId", "category", "startDate", "endDate", "providerAsOf", "payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationCostFact_supersedesId_key" ON "CommunicationCostFact"("supersedesId");

-- CreateIndex
CREATE INDEX "CommunicationCostFact_accountId_occurredAt_classification_idx" ON "CommunicationCostFact"("accountId", "occurredAt", "classification");

-- CreateIndex
CREATE INDEX "CommunicationCostFact_businessNumberId_idx" ON "CommunicationCostFact"("businessNumberId");

-- CreateIndex
CREATE INDEX "CommunicationCostFact_messageAttemptId_idx" ON "CommunicationCostFact"("messageAttemptId");

-- CreateIndex
CREATE INDEX "CommunicationCostFact_callLegId_idx" ON "CommunicationCostFact"("callLegId");

-- CreateIndex
CREATE INDEX "CommunicationCostFact_rateVersionId_idx" ON "CommunicationCostFact"("rateVersionId");

-- CreateIndex
CREATE INDEX "CommunicationCostFact_statementId_idx" ON "CommunicationCostFact"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationCostFact_accountId_sourceKey_classification_key" ON "CommunicationCostFact"("accountId", "sourceKey", "classification");

-- CreateIndex
CREATE INDEX "TelecomRateVersion_accountId_service_component_effectiveFro_idx" ON "TelecomRateVersion"("accountId", "service", "component", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TelecomRateVersion_accountId_service_component_destinationK_key" ON "TelecomRateVersion"("accountId", "service", "component", "destinationKey", "effectiveFrom", "source");

-- CreateIndex
CREATE INDEX "TelecomStatement_accountId_periodStart_periodEnd_idx" ON "TelecomStatement"("accountId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TelecomStatement_accountId_externalId_revision_key" ON "TelecomStatement"("accountId", "externalId", "revision");

-- AddForeignKey
ALTER TABLE "TelecomSyncCursor" ADD CONSTRAINT "TelecomSyncCursor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomUsageSnapshot" ADD CONSTRAINT "TelecomUsageSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_businessNumberId_fkey" FOREIGN KEY ("businessNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_messageAttemptId_fkey" FOREIGN KEY ("messageAttemptId") REFERENCES "MessageAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_callLegId_fkey" FOREIGN KEY ("callLegId") REFERENCES "CallLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_rateVersionId_fkey" FOREIGN KEY ("rateVersionId") REFERENCES "TelecomRateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "CommunicationCostFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "TelecomStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomRateVersion" ADD CONSTRAINT "TelecomRateVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomStatement" ADD CONSTRAINT "TelecomStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TelecomAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelecomStatement" ADD CONSTRAINT "TelecomStatement_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- COM-L10 fail-closed data invariants. Provider prices remain signed exact DECIMAL.
ALTER TABLE "TelecomSyncCursor" ADD CONSTRAINT "TelecomSyncCursor_window_order"
  CHECK ("windowEnd" > "windowStart"
    AND ("completedThrough" IS NULL OR "completedThrough" <= "windowEnd"));
ALTER TABLE "TelecomSyncCursor" ADD CONSTRAINT "TelecomSyncCursor_claim_pair"
  CHECK (("claimToken" IS NULL) = ("claimUntil" IS NULL)
    AND ("claimToken" IS NULL OR (length("claimToken") BETWEEN 1 AND 200)));
ALTER TABLE "TelecomSyncCursor" ADD CONSTRAINT "TelecomSyncCursor_text_bounds"
  CHECK (length(coalesce("nextPageToken", '')) <= 4096
    AND length(coalesce("lastErrorCode", '')) <= 120);

ALTER TABLE "TelecomUsageSnapshot" ADD CONSTRAINT "TelecomUsageSnapshot_provider_dates"
  CHECK ("endDate" >= "startDate");
ALTER TABLE "TelecomUsageSnapshot" ADD CONSTRAINT "TelecomUsageSnapshot_nonnegative_count"
  CHECK ("count" >= 0);
ALTER TABLE "TelecomUsageSnapshot" ADD CONSTRAINT "TelecomUsageSnapshot_currency_hash"
  CHECK ("currency" ~ '^[A-Z]{3}$' AND "payloadHash" ~ '^[0-9a-f]{64}$'
    AND length("category") BETWEEN 1 AND 160
    AND length("countUnit") BETWEEN 1 AND 80
    AND length("usageUnit") BETWEEN 1 AND 80
    AND length("providerSource") BETWEEN 1 AND 80);

ALTER TABLE "CommunicationCostFact" ADD CONSTRAINT "CommunicationCostFact_semantics"
  CHECK ("currency" ~ '^[A-Z]{3}$'
    AND length("sourceKey") BETWEEN 1 AND 220
    AND length("component") BETWEEN 1 AND 120
    AND ("quantity" IS NULL OR "quantity" >= 0)
    AND ("unit" IS NULL OR length("unit") BETWEEN 1 AND 80)
    AND ("supersedesId" IS NULL OR "supersedesId" <> "id")
    AND ("classification" <> 'INVOICE_RECONCILED' OR "statementId" IS NOT NULL));

ALTER TABLE "TelecomRateVersion" ADD CONSTRAINT "TelecomRateVersion_valid_interval"
  CHECK (("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom")
    AND "currency" ~ '^[A-Z]{3}$'
    AND length("service") BETWEEN 1 AND 120
    AND length("category") BETWEEN 1 AND 120
    AND length("component") BETWEEN 1 AND 120
    AND length("destinationKey") BETWEEN 1 AND 130
    AND length("senderType") BETWEEN 1 AND 80
    AND length("unit") BETWEEN 1 AND 80);

ALTER TABLE "TelecomStatement" ADD CONSTRAINT "TelecomStatement_valid_evidence"
  CHECK ("periodEnd" >= "periodStart"
    AND "currency" ~ '^[A-Z]{3}$'
    AND "revision" > 0
    AND "evidenceHash" ~ '^[0-9a-f]{64}$'
    AND length("externalId") BETWEEN 1 AND 160
    AND length("privateEvidenceStorageKey") BETWEEN 1 AND 512
    AND "privateEvidenceStorageKey" ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9._-]+)+$'
    AND "privateEvidenceStorageKey" !~ '(^|/)\.\.(/|$)'
    AND ("state" <> 'VERIFIED' OR ("verifiedByUserId" IS NOT NULL AND "verifiedAt" IS NOT NULL))
    AND ("state" <> 'DRAFT' OR ("verifiedByUserId" IS NULL AND "verifiedAt" IS NULL)));

-- Every optional link stays inside the same verified TelecomAccount. A plain FK
-- to id alone would permit a cross-account attribution when two accounts share a provider.
CREATE FUNCTION "enforce_telecom_cost_scope"() RETURNS trigger AS $$
BEGIN
  IF NEW."businessNumberId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "BusinessPhoneNumber" b
    WHERE b."id" = NEW."businessNumberId" AND b."accountId" = NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'Telecom cost business number belongs to another account' USING ERRCODE = '23514';
  END IF;
  IF NEW."messageAttemptId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "MessageAttempt" m
    WHERE m."id" = NEW."messageAttemptId" AND m."accountId" = NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'Telecom cost message attempt belongs to another account' USING ERRCODE = '23514';
  END IF;
  IF NEW."callLegId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CallLeg" c
    WHERE c."id" = NEW."callLegId" AND c."accountId" = NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'Telecom cost call leg belongs to another account' USING ERRCODE = '23514';
  END IF;
  IF NEW."rateVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "TelecomRateVersion" r
    WHERE r."id" = NEW."rateVersionId" AND r."accountId" = NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'Telecom rate evidence belongs to another account' USING ERRCODE = '23514';
  END IF;
  IF NEW."statementId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "TelecomStatement" s
    WHERE s."id" = NEW."statementId" AND s."accountId" = NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'Telecom statement evidence belongs to another account' USING ERRCODE = '23514';
  END IF;
  IF NEW."supersedesId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CommunicationCostFact" prior
    WHERE prior."id" = NEW."supersedesId"
      AND prior."accountId" = NEW."accountId"
      AND prior."classification" = NEW."classification"
      AND prior."currency" = NEW."currency"
      AND prior."component" = NEW."component"
  ) THEN
    RAISE EXCEPTION 'Telecom cost supersession crosses an account or evidence basis' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CommunicationCostFact_account_scope"
  BEFORE INSERT OR UPDATE ON "CommunicationCostFact"
  FOR EACH ROW EXECUTE FUNCTION "enforce_telecom_cost_scope"();
