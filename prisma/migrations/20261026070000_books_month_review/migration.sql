-- BA-3: optional owner review evidence and settings; old ledger entries stay unchanged.
ALTER TABLE "BusinessSettings" ADD COLUMN "booksReviewReminderDay" INTEGER NOT NULL DEFAULT 15,
 ADD COLUMN "accountantEmail" TEXT;
ALTER TABLE "AccountingPeriod" ADD COLUMN "reviewNotes" JSONB,
 ADD COLUMN "accountantSentAt" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN "noReceiptReason" TEXT;
