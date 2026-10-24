-- M-2C: selling a retired appliance. Additive only.
ALTER TABLE "InvoiceLineItem" ADD COLUMN "applianceId" TEXT;
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InvoiceLineItem_applianceId_idx" ON "InvoiceLineItem"("applianceId");

ALTER TABLE "BookAsset" ADD COLUMN "disposedOn" TIMESTAMP(3);

-- Chart row for existing databases (the chart in code lists it too).
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","createdAt","updatedAt")
VALUES
 ('m2c_book_value_sold','BOOK_VALUE_OF_APPLIANCES_SOLD','Book value of retired appliances sold','EXPENSE','What a retired appliance was still worth on the books when it was sold (its sale price is in Sales of retired appliances)',FALSE,TRUE,97,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("systemRole") DO NOTHING;
