-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'CONTRA_ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'CONTRA_INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalSourceType" AS ENUM ('OPENING', 'INVOICE', 'RECEIPT', 'PAYMENT', 'DEPOSIT', 'CUSTOMER_CREDIT', 'CREDIT_APPLICATION', 'REFUND', 'STRIPE_BALANCE_TXN', 'EXPENSE', 'APPLIANCE', 'USE_TAX', 'TAX_FILING');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "ExportTarget" AS ENUM ('QBO_JOURNAL_CSV', 'XERO_JOURNAL_CSV', 'GENERIC_JOURNAL_CSV', 'CASH_MOVEMENTS_CSV');

-- CreateEnum
CREATE TYPE "ExportMode" AS ENUM ('DAILY_SUMMARY', 'DETAIL');

-- AlterTable
ALTER TABLE "ApplianceType" ADD COLUMN     "depreciationMonths" INTEGER;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "is1099Vendor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxIdOnFile" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "badDebtTaxRecovery" TEXT NOT NULL DEFAULT 'UNDECIDED',
ADD COLUMN     "booksStartDate" TIMESTAMP(3),
ADD COLUMN     "depreciationMonthsDefault" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "depreciationSalvagePercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "exportPayoutLines" JSONB NOT NULL DEFAULT '{"QBO_JOURNAL_CSV":true,"XERO_JOURNAL_CSV":false,"GENERIC_JOURNAL_CSV":true,"CASH_MOVEMENTS_CSV":true}',
ADD COLUMN     "lemonRepairPercent" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "vendor1099ThresholdCents" INTEGER NOT NULL DEFAULT 200000;

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "systemRole" TEXT,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "description" TEXT NOT NULL,
    "isPaymentSource" BOOLEAN NOT NULL DEFAULT false,
    "filingAccountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountExportMapping" (
    "id" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "target" "ExportTarget" NOT NULL,
    "externalName" TEXT NOT NULL,
    "externalTaxRate" TEXT,

    CONSTRAINT "AccountExportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" SERIAL NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "periodKey" TEXT NOT NULL,
    "sourceType" "JournalSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "customerId" TEXT,
    "applianceId" TEXT,
    "lateForDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "periodKey" TEXT NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "reopenedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("periodKey")
);

-- CreateTable
CREATE TABLE "StripeBalanceTransaction" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reportingCategory" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceId" TEXT,
    "payoutId" TEXT,
    "description" TEXT,
    "createdAtStripe" TIMESTAMP(3) NOT NULL,
    "availableOn" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeBalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "status" "ExpenseStatus" NOT NULL,
    "spentOn" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vendorTaxCents" INTEGER NOT NULL DEFAULT 0,
    "vendorName" TEXT NOT NULL,
    "supplierId" TEXT,
    "categoryId" TEXT NOT NULL,
    "paidFromAccountId" TEXT NOT NULL,
    "memo" TEXT,
    "receiptPhotoId" TEXT,
    "applianceId" TEXT,
    "jobId" TEXT,
    "purchaseOrderId" TEXT,
    "capitalizeToAppliance" BOOLEAN NOT NULL DEFAULT false,
    "recurringExpenseId" TEXT,
    "submittedByUserId" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "paidFromAccountId" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCreatedFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportBatch" (
    "id" TEXT NOT NULL,
    "target" "ExportTarget" NOT NULL,
    "mode" "ExportMode" NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportBatchEntry" (
    "exportBatchId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,

    CONSTRAINT "ExportBatchEntry_pkey" PRIMARY KEY ("exportBatchId","journalEntryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_systemRole_key" ON "LedgerAccount"("systemRole");

-- CreateIndex
CREATE UNIQUE INDEX "AccountExportMapping_ledgerAccountId_target_key" ON "AccountExportMapping"("ledgerAccountId", "target");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");

-- CreateIndex
CREATE INDEX "JournalEntry_periodKey_idx" ON "JournalEntry"("periodKey");

-- CreateIndex
CREATE INDEX "JournalEntry_entryDate_idx" ON "JournalEntry"("entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_eventKind_key" ON "JournalEntry"("sourceType", "sourceId", "eventKind");

-- CreateIndex
CREATE INDEX "JournalLine_ledgerAccountId_idx" ON "JournalLine"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "StripeBalanceTransaction_createdAtStripe_idx" ON "StripeBalanceTransaction"("createdAtStripe");

-- CreateIndex
CREATE INDEX "StripeBalanceTransaction_payoutId_idx" ON "StripeBalanceTransaction"("payoutId");

-- CreateIndex
CREATE INDEX "Expense_status_spentOn_idx" ON "Expense"("status", "spentOn");

-- CreateIndex
CREATE INDEX "Expense_applianceId_idx" ON "Expense"("applianceId");

-- CreateIndex
CREATE INDEX "Expense_submittedByUserId_idx" ON "Expense"("submittedByUserId");

-- CreateIndex
CREATE INDEX "ExportBatchEntry_journalEntryId_idx" ON "ExportBatchEntry"("journalEntryId");

-- AddForeignKey
ALTER TABLE "AccountExportMapping" ADD CONSTRAINT "AccountExportMapping_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatchEntry" ADD CONSTRAINT "ExportBatchEntry_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "ExportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatchEntry" ADD CONSTRAINT "ExportBatchEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A journal line has at most one nonzero side and never a negative amount.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amounts_check" CHECK ("debitCents" >= 0 AND "creditCents" >= 0 AND NOT ("debitCents" > 0 AND "creditCents" > 0));

-- Seed stable identifiers, never reset an owner-renamed account.
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","isPaymentSource","active","sortOrder","createdAt","updatedAt")
SELECT concat('k_seed_', row_number() OVER (ORDER BY role)), role, name, type::"LedgerAccountType", description, "paymentSource", TRUE, row_number() OVER (ORDER BY role), now(), now() FROM jsonb_to_recordset('[{"role": "BANK", "name": "Business checking", "type": "ASSET", "description": "Business checking", "paymentSource": true}, {"role": "STRIPE_CLEARING", "name": "Stripe balance (clearing)", "type": "ASSET", "description": "Stripe balance (clearing)", "paymentSource": false}, {"role": "UNDEPOSITED", "name": "Cash and checks not yet deposited", "type": "ASSET", "description": "Cash and checks not yet deposited", "paymentSource": false}, {"role": "RECEIVABLES", "name": "Customer balances owed (Appliance Desk)", "type": "ASSET", "description": "Customer balances owed (Appliance Desk)", "paymentSource": false}, {"role": "RENTAL_EQUIPMENT", "name": "Rental appliances (cost)", "type": "ASSET", "description": "Rental appliances (cost)", "paymentSource": false}, {"role": "ACCUM_DEPRECIATION", "name": "Rental appliances — depreciation to date", "type": "CONTRA_ASSET", "description": "Rental appliances — depreciation to date", "paymentSource": false}, {"role": "CARD", "name": "Business credit card", "type": "LIABILITY", "description": "Business credit card", "paymentSource": true}, {"role": "DEPOSITS_HELD", "name": "Customer deposits held", "type": "LIABILITY", "description": "Customer deposits held", "paymentSource": false}, {"role": "CUSTOMER_CREDITS", "name": "Customer account credits", "type": "LIABILITY", "description": "Customer account credits", "paymentSource": false}, {"role": "UNAPPLIED_RECEIPTS", "name": "Payments not yet matched to a bill", "type": "LIABILITY", "description": "Payments not yet matched to a bill", "paymentSource": false}, {"role": "SALES_TAX_UNASSIGNED", "name": "Sales tax owed — area not yet assigned", "type": "LIABILITY", "description": "Sales tax owed — area not yet assigned", "paymentSource": false}, {"role": "OWNER_CONTRIBUTIONS", "name": "Owner contributions", "type": "EQUITY", "description": "Owner contributions", "paymentSource": true}, {"role": "RENTAL_INCOME", "name": "Rental income", "type": "INCOME", "description": "Rental income", "paymentSource": false}, {"role": "LATE_RETURN_INCOME", "name": "Late-return rent", "type": "INCOME", "description": "Late-return rent", "paymentSource": false}, {"role": "DELIVERY_INCOME", "name": "Delivery fees", "type": "INCOME", "description": "Delivery fees", "paymentSource": false}, {"role": "INSTALLATION_INCOME", "name": "Installation fees", "type": "INCOME", "description": "Installation fees", "paymentSource": false}, {"role": "REMOVAL_INCOME", "name": "Removal fees", "type": "INCOME", "description": "Removal fees", "paymentSource": false}, {"role": "DAMAGE_WAIVER_INCOME", "name": "Damage waiver", "type": "INCOME", "description": "Damage waiver", "paymentSource": false}, {"role": "LATE_FEE_INCOME", "name": "Late payment fees", "type": "INCOME", "description": "Late payment fees", "paymentSource": false}, {"role": "EARLY_TERMINATION_INCOME", "name": "Early-ending fees", "type": "INCOME", "description": "Early-ending fees", "paymentSource": false}, {"role": "DAMAGE_RECOVERY_INCOME", "name": "Kept from deposits for damage", "type": "INCOME", "description": "Kept from deposits for damage", "paymentSource": false}, {"role": "TAX_SERVICE_FEE_INCOME", "name": "Sales tax collection allowance", "type": "INCOME", "description": "Sales tax collection allowance", "paymentSource": false}, {"role": "OTHER_INCOME", "name": "Other income", "type": "INCOME", "description": "Other income", "paymentSource": false}, {"role": "DISCOUNTS", "name": "Discounts and waivers", "type": "CONTRA_INCOME", "description": "Discounts and waivers", "paymentSource": false}, {"role": "CREDITS_GIVEN", "name": "Credits given to customers", "type": "CONTRA_INCOME", "description": "Credits given to customers", "paymentSource": false}, {"role": "REFUNDS", "name": "Refunds", "type": "CONTRA_INCOME", "description": "Refunds", "paymentSource": false}, {"role": "CARD_FEES", "name": "Card processing fees", "type": "EXPENSE", "description": "Card processing fees", "paymentSource": false}, {"role": "STRIPE_SERVICE_FEES", "name": "Stripe billing and service fees", "type": "EXPENSE", "description": "Stripe billing and service fees", "paymentSource": false}, {"role": "CHARGEBACKS", "name": "Disputed payments", "type": "EXPENSE", "description": "Disputed payments", "paymentSource": false}, {"role": "BAD_DEBT", "name": "Bad debt (written off)", "type": "EXPENSE", "description": "Bad debt (written off)", "paymentSource": false}, {"role": "DEPRECIATION", "name": "Depreciation", "type": "EXPENSE", "description": "Depreciation", "paymentSource": false}, {"role": "DISPOSAL_LOSS", "name": "Loss on retired appliances", "type": "EXPENSE", "description": "Loss on retired appliances", "paymentSource": false}, {"role": "USE_TAX_EXPENSE", "name": "Use tax on purchases", "type": "EXPENSE", "description": "Use tax on purchases", "paymentSource": false}, {"role": "REPAIRS_PARTS", "name": "Repair parts", "type": "EXPENSE", "description": "Repair parts", "paymentSource": false}, {"role": "TAX_ADJUSTMENTS", "name": "Sales tax rounding and adjustments", "type": "EXPENSE", "description": "Sales tax rounding and adjustments", "paymentSource": false}, {"role": "EXPENSE_FUEL", "name": "Fuel", "type": "EXPENSE", "description": "Fuel", "paymentSource": false}, {"role": "EXPENSE_VEHICLE_REPAIRS_AND_MAINTENANCE", "name": "Vehicle repairs and maintenance", "type": "EXPENSE", "description": "Vehicle repairs and maintenance", "paymentSource": false}, {"role": "EXPENSE_VEHICLE_INSURANCE", "name": "Vehicle insurance", "type": "EXPENSE", "description": "Vehicle insurance", "paymentSource": false}, {"role": "EXPENSE_BUSINESS_INSURANCE", "name": "Business insurance", "type": "EXPENSE", "description": "Business insurance", "paymentSource": false}, {"role": "EXPENSE_STORAGE___WAREHOUSE_RENT", "name": "Storage / warehouse rent", "type": "EXPENSE", "description": "Storage / warehouse rent", "paymentSource": false}, {"role": "EXPENSE_PHONE_AND_INTERNET", "name": "Phone and internet", "type": "EXPENSE", "description": "Phone and internet", "paymentSource": false}, {"role": "EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS", "name": "Software and subscriptions", "type": "EXPENSE", "description": "Software and subscriptions", "paymentSource": false}, {"role": "EXPENSE_ADVERTISING_AND_MARKETING", "name": "Advertising and marketing", "type": "EXPENSE", "description": "Advertising and marketing", "paymentSource": false}, {"role": "EXPENSE_SUPPLIES", "name": "Supplies", "type": "EXPENSE", "description": "Supplies", "paymentSource": false}, {"role": "EXPENSE_SMALL_TOOLS_AND_EQUIPMENT", "name": "Small tools and equipment", "type": "EXPENSE", "description": "Small tools and equipment", "paymentSource": false}, {"role": "EXPENSE_PROFESSIONAL_FEES__CPA__LEGAL", "name": "Professional fees (CPA, legal)", "type": "EXPENSE", "description": "Professional fees (CPA, legal)", "paymentSource": false}, {"role": "EXPENSE_LICENSES_AND_PERMITS", "name": "Licenses and permits", "type": "EXPENSE", "description": "Licenses and permits", "paymentSource": false}, {"role": "EXPENSE_BANK_FEES", "name": "Bank fees", "type": "EXPENSE", "description": "Bank fees", "paymentSource": false}, {"role": "EXPENSE_OTHER", "name": "Other", "type": "EXPENSE", "description": "Other", "paymentSource": false}, {"role": "RETAIL_DELIVERY_FEE_PAYABLE", "name": "Colorado retail delivery fees owed", "type": "LIABILITY", "description": "Colorado retail delivery fees collected but not yet remitted", "paymentSource": false}]'::jsonb) AS s(role text,name text,type text, description text, "paymentSource" boolean)
ON CONFLICT ("systemRole") DO NOTHING;

-- Existing tax filing accounts get stable ledgers; new ones are synchronized by the account domain.
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","filingAccountId","createdAt","updatedAt")
SELECT concat('k_tax_sales_', id), concat('SALES_TAX:',id), concat('Sales tax owed — ',name), 'LIABILITY'::"LedgerAccountType", concat('Sales tax owed — ',name), id, now(), now() FROM "TaxFilingAccount"
ON CONFLICT ("systemRole") DO NOTHING;
INSERT INTO "LedgerAccount" ("id","systemRole","name","type","description","filingAccountId","createdAt","updatedAt")
SELECT concat('k_tax_use_', id), concat('USE_TAX:',id), concat('Use tax owed — ',name), 'LIABILITY'::"LedgerAccountType", concat('Use tax owed — ',name), id, now(), now() FROM "TaxFilingAccount"
ON CONFLICT ("systemRole") DO NOTHING;

INSERT INTO "ExpenseCategory" ("id","name","description","ledgerAccountId","active","sortOrder","createdAt")
SELECT concat('k_category_', row_number() OVER (ORDER BY c.name)), c.name, c.name, a.id, TRUE, row_number() OVER (ORDER BY c.name), now() FROM jsonb_to_recordset('[{"name": "Fuel", "role": "EXPENSE_FUEL"}, {"name": "Vehicle repairs and maintenance", "role": "EXPENSE_VEHICLE_REPAIRS_AND_MAINTENANCE"}, {"name": "Vehicle insurance", "role": "EXPENSE_VEHICLE_INSURANCE"}, {"name": "Business insurance", "role": "EXPENSE_BUSINESS_INSURANCE"}, {"name": "Storage / warehouse rent", "role": "EXPENSE_STORAGE___WAREHOUSE_RENT"}, {"name": "Phone and internet", "role": "EXPENSE_PHONE_AND_INTERNET"}, {"name": "Software and subscriptions", "role": "EXPENSE_SOFTWARE_AND_SUBSCRIPTIONS"}, {"name": "Advertising and marketing", "role": "EXPENSE_ADVERTISING_AND_MARKETING"}, {"name": "Supplies", "role": "EXPENSE_SUPPLIES"}, {"name": "Small tools and equipment", "role": "EXPENSE_SMALL_TOOLS_AND_EQUIPMENT"}, {"name": "Repair parts", "role": "REPAIRS_PARTS"}, {"name": "Professional fees (CPA, legal)", "role": "EXPENSE_PROFESSIONAL_FEES__CPA__LEGAL"}, {"name": "Licenses and permits", "role": "EXPENSE_LICENSES_AND_PERMITS"}, {"name": "Bank fees", "role": "EXPENSE_BANK_FEES"}, {"name": "Other", "role": "EXPENSE_OTHER"}, {"name": "Rental appliance purchase", "role": "RENTAL_EQUIPMENT"}]'::jsonb) AS c(name text,role text) JOIN "LedgerAccount" a ON a."systemRole"=c.role WHERE NOT EXISTS (SELECT 1 FROM "ExpenseCategory" x WHERE x.name=c.name);
