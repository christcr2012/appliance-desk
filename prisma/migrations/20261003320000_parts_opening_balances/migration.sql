-- Batch C P1-C (data): one OPENING_BALANCE movement per part that already has stock.
-- Received purchase orders are NOT replayed into movements.
INSERT INTO "PartStockMovement" ("id","partRecordId","kind","quantityDelta","balanceAfter","unitCostCents","operationKey","payloadHash","reason","createdAt")
SELECT 'opening_' || "id", "id", 'OPENING_BALANCE', "quantityOnHand", "quantityOnHand", NULL,
       'opening:' || "id", 'opening', 'Balance when the ledger started', NOW()
FROM "PartRecord" WHERE "quantityOnHand" > 0;
