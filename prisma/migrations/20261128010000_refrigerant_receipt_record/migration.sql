-- OPS-2: link a refrigerant record to the business record that holds the recycler's receipt (additive, optional).
ALTER TABLE "RefrigerantRecord" ADD COLUMN "receiptRecordId" TEXT;
CREATE UNIQUE INDEX "RefrigerantRecord_receiptRecordId_key" ON "RefrigerantRecord"("receiptRecordId");
ALTER TABLE "RefrigerantRecord" ADD CONSTRAINT "RefrigerantRecord_receiptRecordId_fkey" FOREIGN KEY ("receiptRecordId") REFERENCES "BusinessPaperwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
