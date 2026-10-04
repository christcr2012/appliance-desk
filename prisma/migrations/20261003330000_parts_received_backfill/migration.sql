-- Batch C P1-C (data, separate on purpose): partial-receipt counters and "is this cost real" flags.
UPDATE "PurchaseOrderLineItem" l SET "receivedQuantity" = l."quantity"
FROM "PurchaseOrder" p WHERE p."id" = l."purchaseOrderId" AND p."status" = 'RECEIVED';
UPDATE "PurchaseOrderLineItem" SET "unitCostKnown" = true WHERE "unitCostCents" > 0;
