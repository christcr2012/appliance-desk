-- COM-N3: additive link from a verified telecom statement to the one books Expense it became.
ALTER TABLE "TelecomStatement" ADD COLUMN "paidFromAccountId" TEXT;
ALTER TABLE "TelecomStatement" ADD COLUMN "expenseId" TEXT;
CREATE UNIQUE INDEX "TelecomStatement_expenseId_key" ON "TelecomStatement"("expenseId");
ALTER TABLE "TelecomStatement" ADD CONSTRAINT "TelecomStatement_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
