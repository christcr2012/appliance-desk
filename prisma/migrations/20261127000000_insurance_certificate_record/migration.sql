-- OPS-4 + VAULT-1: an insurance policy can point at the business record that holds its certificate PDF.
-- Additive: one nullable column, a unique index (one record per policy) and a foreign key that clears on delete.
ALTER TABLE "OwnerInsurancePolicy" ADD COLUMN "recordId" TEXT;
CREATE UNIQUE INDEX "OwnerInsurancePolicy_recordId_key" ON "OwnerInsurancePolicy"("recordId");
ALTER TABLE "OwnerInsurancePolicy" ADD CONSTRAINT "OwnerInsurancePolicy_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "BusinessPaperwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
