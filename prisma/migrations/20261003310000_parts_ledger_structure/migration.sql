-- Batch C P1-C: parts ledger (append-only), partial receipts, archival.

-- CreateEnum
CREATE TYPE "PartMovementKind" AS ENUM ('OPENING_BALANCE', 'RECEIPT', 'USAGE', 'ADJUSTMENT', 'RECOUNT', 'REVERSAL');

-- AlterTable
ALTER TABLE "PartRecord" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrderLineItem" ADD COLUMN "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unitCostKnown" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PartStockMovement" (
    "id" TEXT NOT NULL,
    "partRecordId" TEXT NOT NULL,
    "kind" "PartMovementKind" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "purchaseOrderLineItemId" TEXT,
    "jobId" TEXT,
    "reversesMovementId" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartStockMovement_reversesMovementId_key" ON "PartStockMovement"("reversesMovementId");
CREATE INDEX "PartStockMovement_partRecordId_createdAt_idx" ON "PartStockMovement"("partRecordId", "createdAt");
CREATE INDEX "PartStockMovement_jobId_idx" ON "PartStockMovement"("jobId");
CREATE INDEX "PartStockMovement_purchaseOrderLineItemId_idx" ON "PartStockMovement"("purchaseOrderLineItemId");
CREATE UNIQUE INDEX "PartStockMovement_partRecordId_operationKey_key" ON "PartStockMovement"("partRecordId", "operationKey");

-- AddForeignKey
ALTER TABLE "PartStockMovement" ADD CONSTRAINT "PartStockMovement_partRecordId_fkey" FOREIGN KEY ("partRecordId") REFERENCES "PartRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartStockMovement" ADD CONSTRAINT "PartStockMovement_purchaseOrderLineItemId_fkey" FOREIGN KEY ("purchaseOrderLineItemId") REFERENCES "PurchaseOrderLineItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartStockMovement" ADD CONSTRAINT "PartStockMovement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the database itself enforces
ALTER TABLE "PartRecord" ADD CONSTRAINT "PartRecord_quantityOnHand_nonneg" CHECK ("quantityOnHand" >= 0);
ALTER TABLE "PartStockMovement" ADD CONSTRAINT "PartStockMovement_delta_nonzero" CHECK ("quantityDelta" <> 0 AND "balanceAfter" >= 0);

CREATE FUNCTION "part_movement_append_only"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Part movements cannot be changed or deleted; add a reversal instead.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PartStockMovement_append_only" BEFORE UPDATE OR DELETE ON "PartStockMovement"
  FOR EACH ROW EXECUTE FUNCTION "part_movement_append_only"();
