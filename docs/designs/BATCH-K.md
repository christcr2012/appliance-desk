# Design — Batch K: Books — journal, expenses, Stripe fees, profit & loss, accounting exports

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-06: "I love all of this! Update the repo!"). Run the drift check in section 0 before starting.
Written 2026-10-06 by Claude Opus 5.5 against `main` 23eff64 (#260). Plain-English summary for Chris:
`docs/plans/TAX-AND-BOOKS-OVERVIEW.md`. Scope and acceptance: `docs/PLAN.md` → Batch K. **Depends on Batch T**
(sales tax lines, `allocateAcrossLines`, use tax, filing periods).

**Who this is written for.** An implementing model (for example ChatGPT Sol 5.6 or Claude Sonnet 5.5) that follows it
literally. Every decision in section 1 is made. Do not re-decide; do not add tables, columns, enums, settings,
libraries or patterns this document does not name. Where it is silent on something that matters, stop (section 8).

**This batch does not replace Chris's accountant or his accounting software.** It turns what the app already knows
into proper double-entry bookkeeping, adds what it doesn't know yet (expenses, Stripe's fees and payouts,
depreciation), shows Chris his profit, and hands clean files to QuickBooks Online, Xero or anything that imports
journals. Tax depreciation, filing income tax and payroll stay with the CPA.

---

## Why this batch exists (read once)

Today the app records money **coming in** carefully (receipts, payments, credits, refunds, deposits, write-offs) but
nothing going **out**, no Stripe fees, and no accounts. The Reports page shows estimated vs collected rent and the
accounting export (`src/domains/reports/accounting-export.ts`, `/desk/reports/export`) is a single CSV of every money
movement since day one — no date range, no tax split, no accounts. A bookkeeper cannot load it into QuickBooks
without re-keying.

---

## 0. Verify before starting (drift check)

| # | Assumption | How to check |
|---|---|---|
| K-A1 | Batch T is merged: `InvoiceTaxLine`, `TaxFilingAccount`, `TaxFilingPeriod`, `PurchaseUseTax`, `allocateAcrossLines` exist. | schema + `src/domains/tax/allocate.ts` |
| K-A2 | `getAccountingTransactions` returns exactly four money-movement types (Payment, Refund, Refund to account credit, Deposit refunded). Every one must get a posting rule here. | read `src/domains/reports/accounting-export.ts` |
| K-A3 | Receipts (`Receipt`, source STRIPE/MANUAL) fund `Payment` allocations to invoices and can fund a `Deposit` (`sourceReceiptId`); overpayments become `CustomerCredit` rows with `sourceType` naming the receipt. Find the exact `sourceType` strings and the `Payment.status` value(s) that mean money arrived (see `src/domains/billing/collected.ts`, `revenue-records.ts`, `ledger.ts`). | grep `sourceType:` and `status:` in `src/domains/billing` |
| K-A4 | **No invoice carries a `DEPOSIT` line item** when the deposit is also a `Deposit` row funded by a receipt (otherwise deposits would be posted twice). | grep writes of `kind: "DEPOSIT"`; if any exist, stop (S-K1) |
| K-A5 | Every code path that writes an `InvoiceLineItem` of kind `CREDIT` is backed by a `CustomerCredit` (`applied-credit-lines.ts`, `webhooks.ts` shown credits, local `CreditApplication`). | grep `kind: "CREDIT"`; list each path in the PR; any unbacked path → stop (S-K2) |
| K-A6 | `Invoice` has no issue-date column; use `billingPeriodStart ?? createdAt`. Stripe invoices are mirrored when paid or when payment fails. Void = status `VOID` (date `cancelledAt ?? updatedAt`); write-off = `writtenOffAt`. | schema + `webhooks-base.ts` |
| K-A7 | `Appliance.acquisitionCostCents`, `purchaseDate`, `archivedAt`, `ApplianceStatus` (find the retired value) exist; `Job.partsCostCents/laborCostCents` exist. | schema |
| K-A8 | The private upload route (`/api/uploads/photo`, `src/domains/uploads`) can store a photo not attached to an appliance or job. If not, the receipt photo design needs a small amendment — stop (S-K3). | read the route and domain |
| K-A9 | `METRICS` in `src/domains/reports/definitions.ts` is the registry every report number must use (Batch D). | read it |
| K-A10 | The Stripe library in `src/lib/stripe.ts` exposes `balanceTransactions.list` and `balance.retrieve` with the pinned API version. | `node -e` against the installed `stripe` package types, or read `node_modules/stripe/types` |

---

## 1. Decisions (made — do not re-open)

### D-K1 — Appliance Desk is the customer sub-ledger; accounting software gets summarized journals

Customer-level detail (who owes what, every invoice) stays in Appliance Desk. QuickBooks/Xero receive **double-entry
journal entries**, by default **one summarized journal per day** (lines grouped by account), where customer balances
are a plain *current asset* account ("Customer balances owed (Appliance Desk)") rather than the software's built-in
Accounts Receivable. Reasons: Xero does not allow manual journals to its system Accounts Receivable account; QuickBooks
requires a customer name on every A/R journal line, which would force syncing every customer; summarized journals
import the same way into every mainstream package; and there is one source of truth for customer balances. A
**detail** mode (one journal per app entry, no customer names) is offered for bookkeepers who want it.

### D-K2 — The journal is derived, append-only and rebuildable

Every journal entry is computed from an existing record (invoice, receipt, payment, credit, refund, deposit, expense,
Stripe balance transaction, appliance, filing period) by a pure posting rule, and stored once with the unique key
`(sourceType, sourceId, eventKind)`. Billing code is **not** changed to post entries: a poster finds records without
their entries and posts them (nightly automation, a "Bring the books up to date" button, and before every export or
report). Because entries derive from records, the batch can ship after launch and still produce books from the first
day (`booksStartDate`). Entries are never edited or deleted; a change is a reversing entry plus a new one.

### D-K3 — Accrual journal; cash-basis view computed

The journal is accrual (revenue when an invoice is recognized, cost when an expense is dated). The P&L screen also
offers **cash basis**: income = payments and credits applied in the month, split across each invoice's non-tax lines
with `allocateAcrossLines`; expenses by `spentOn`. Both are labelled on screen with what they mean.

### D-K4 — Stripe is a clearing account, synced from balance transactions

Card money lands in "Stripe balance (clearing)" at the **gross** amount. A nightly automation pulls Stripe balance
transactions since a stored cursor and stores them (`StripeBalanceTransaction`); posting rules book card fees, Stripe's
own billing/tax fees, disputes, and payouts (clearing → bank). A daily check compares the clearing account's balance
with Stripe's reported balance; a difference of 1 cent or more becomes an exception card. Unknown transaction types are
stored, not posted, and raise a card (S-K4).

### D-K5 — Chart of accounts: system accounts plus owner categories; names are the owner's

The migration seeds the system accounts in section 2.1 with plain names. The owner can rename any account and add
expense categories and payment sources, but cannot delete a system account or change its type. Each account has, per
export target, the **name or code it has in Chris's accounting software** (`AccountExportMapping`); an export refuses
to run while any used account lacks a mapping, listing them.

### D-K6 — Months close

`AccountingPeriod` (`YYYY-MM`) can be closed by the owner after exporting. An entry whose date falls in a closed month
is dated the first day of the next open month with `lateForDate` set and the memo "Late entry for <date>" — filed
numbers never move. Re-opening needs the owner and a written reason (audit log).

### D-K7 — Files first; direct QuickBooks sync later

Batch K ships four file exports (section 3.6): QuickBooks Online journal CSV, Xero manual journal CSV, generic journal
CSV (Zoho Books, FreshBooks and most others), and cash-movements CSV (Wave and any package that only imports bank-style
transactions). Exports are deterministic (same period + target + mode = byte-identical file), stored, and remembered
per entry ("exported on …"). QuickBooks Desktop IIF is not built (Intuit stopped selling Desktop to new US
subscribers; listed in ROADMAP). **Direct QuickBooks Online sync** (Intuit API: writes are free under Intuit's App
Partner Program Builder tier; reads are metered) is section 9, a later phase that needs its own approval.

### D-K8 — Expenses: phone-first, receipt photo, never deleted

Expense = date, amount, tax the seller charged, vendor, category (→ account), paid-from account (business checking,
business card, "paid personally" = owner contribution), memo, optional receipt photo, optional links to an appliance,
job or purchase order, and "this is the purchase of a rental appliance" (capitalize: debit Rental appliances and set the
appliance's acquisition cost if empty). Staff may **submit** their own expenses (fuel, supplies) with a photo; owner or
admin **posts** them. Posted expenses can be voided with a reason (reversing entry), never deleted. Parts are expensed
when bought (no inventory valuation in the books; the parts quantity ledger stays operational only). Recurring
expenses (insurance, storage rent, software) are templates that create **draft** expenses on their day for the owner to
confirm — never posted automatically.

### D-K9 — Book depreciation, straight-line, owner-set

Each appliance with a known cost depreciates straight-line from the month after it was bought (`purchaseDate`, else
`createdAt`) over `ApplianceType.depreciationMonths` (else `BusinessSettings.depreciationMonthsDefault`, starting value
**60 months** — residential appliances are generally 5-year property; screen says "for your own profit numbers; your
CPA handles tax depreciation"), down to `depreciationSalvagePercent` of cost (starting value **0%**). The last month
absorbs rounding. Stops when the appliance is retired/archived (a disposal entry writes off the remaining book value as
"Loss on retired appliances"; sale proceeds are out of scope — S-K6).

### D-K10 — Tax inside refunds and write-offs

A refund's tax portion = `allocateAcrossLines(refund, [invoice non-tax total, invoice tax total])[1]`, debited to the
sales-tax payable account(s) in proportion to the invoice's `InvoiceTaxLine` rows; the rest to "Refunds". A write-off's
tax portion is debited to sales tax payable **only** when `BusinessSettings.badDebtTaxRecovery = "YES"` (starting
value `UNDECIDED`, treated as NO: the whole open balance goes to bad debt and the tax stays owed — the conservative
choice until the CPA answers IN-39).

### D-K11 — Permissions

OWNER: everything. ADMIN: view books and reports, post/void expenses, run exports; cannot close/re-open months, edit the
chart of accounts or mappings, or change book settings. STAFF: submit and view **their own** submitted expenses only;
no reports. CUSTOMER: nothing. Enforced in domain functions.

---

## 2. Schema changes (additive only) — migration `<timestamp>_batch_k_books`

```prisma
enum LedgerAccountType { ASSET CONTRA_ASSET LIABILITY EQUITY INCOME CONTRA_INCOME EXPENSE }
enum JournalSourceType { INVOICE RECEIPT PAYMENT DEPOSIT CUSTOMER_CREDIT CREDIT_APPLICATION REFUND STRIPE_BALANCE_TXN EXPENSE APPLIANCE USE_TAX TAX_FILING }
enum AccountingPeriodStatus { OPEN CLOSED }
enum ExpenseStatus { DRAFT SUBMITTED POSTED VOID }
enum ExportTarget { QBO_JOURNAL_CSV XERO_JOURNAL_CSV GENERIC_JOURNAL_CSV CASH_MOVEMENTS_CSV }
enum ExportMode { DAILY_SUMMARY DETAIL }

model LedgerAccount {
  id              String            @id @default(cuid())
  systemRole      String?           @unique // section 2.1; null for owner-added accounts
  name            String
  type            LedgerAccountType
  description     String            // plain words, shown on screen
  isPaymentSource Boolean           @default(false)
  filingAccountId String?           // set for per-filing-account tax payable accounts
  active          Boolean           @default(true)
  sortOrder       Int               @default(0)
  mappings        AccountExportMapping[]
  lines           JournalLine[]
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
}

model AccountExportMapping {
  id              String        @id @default(cuid())
  ledgerAccountId String
  ledgerAccount   LedgerAccount @relation(fields: [ledgerAccountId], references: [id])
  target          ExportTarget
  externalName    String        // QuickBooks account name ("Parent:Child" for sub-accounts) or Xero account code
  externalTaxRate String?       // Xero only; starting value "Tax Exempt"
  @@unique([ledgerAccountId, target])
}

model JournalEntry {
  id          String            @id @default(cuid())
  entryNumber Int               @unique @default(autoincrement())
  entryDate   DateTime          // Colorado midnight of the business date
  periodKey   String            // "YYYY-MM" of entryDate (Colorado)
  sourceType  JournalSourceType
  sourceId    String
  eventKind   String            // section 3.2 names
  memo        String
  customerId  String?
  applianceId String?
  lateForDate DateTime?
  lines       JournalLine[]
  exports     ExportBatchEntry[]
  createdAt   DateTime          @default(now())

  @@unique([sourceType, sourceId, eventKind])
  @@index([periodKey])
  @@index([entryDate])
}

model JournalLine {
  id              String        @id @default(cuid())
  entryId         String
  entry           JournalEntry  @relation(fields: [entryId], references: [id])
  ledgerAccountId String
  ledgerAccount   LedgerAccount @relation(fields: [ledgerAccountId], references: [id])
  debitCents      Int           @default(0)
  creditCents     Int           @default(0)
  memo            String?

  @@index([ledgerAccountId])
  @@index([entryId])
}

model AccountingPeriod {
  periodKey       String                 @id
  status          AccountingPeriodStatus @default(OPEN)
  closedAt        DateTime?
  closedByUserId  String?
  reopenedReason  String?
  updatedAt       DateTime               @updatedAt
}

model StripeBalanceTransaction {
  id                String   @id // Stripe txn_… id
  type              String
  reportingCategory String
  amountCents       Int
  feeCents          Int
  netCents          Int
  currency          String
  sourceId          String?
  payoutId          String?
  description       String?
  createdAtStripe   DateTime
  availableOn       DateTime
  syncedAt          DateTime @default(now())

  @@index([createdAtStripe])
  @@index([payoutId])
}

model IntegrationCursor {
  key       String   @id // "stripe-balance-transactions"
  value     String
  updatedAt DateTime @updatedAt
}

model ExpenseCategory {
  id              String   @id @default(cuid())
  name            String
  description     String
  ledgerAccountId String
  active          Boolean  @default(true)
  sortOrder       Int      @default(0)
  expenses        Expense[]
  createdAt       DateTime @default(now())
}

model Expense {
  id                   String          @id @default(cuid())
  status               ExpenseStatus
  spentOn              DateTime
  amountCents          Int             // total paid, including any tax the seller charged
  vendorTaxCents       Int             @default(0)
  vendorName           String
  supplierId           String?
  categoryId           String
  category             ExpenseCategory @relation(fields: [categoryId], references: [id])
  paidFromAccountId    String
  memo                 String?
  receiptPhotoId       String?
  applianceId          String?
  jobId                String?
  purchaseOrderId      String?
  capitalizeToAppliance Boolean        @default(false)
  recurringExpenseId   String?
  submittedByUserId    String
  postedByUserId       String?
  postedAt             DateTime?
  voidedAt             DateTime?
  voidedByUserId       String?
  voidReason           String?
  version              Int             @default(1)
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt

  @@index([status, spentOn])
  @@index([applianceId])
  @@index([submittedByUserId])
}

model RecurringExpense {
  id                String   @id @default(cuid())
  name              String
  vendorName        String
  amountCents       Int
  categoryId        String
  paidFromAccountId String
  dayOfMonth        Int      // 1–28
  active            Boolean  @default(true)
  lastCreatedFor    String?  // "YYYY-MM"
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model ExportBatch {
  id              String       @id @default(cuid())
  target          ExportTarget
  mode            ExportMode
  periodFrom      DateTime
  periodTo        DateTime
  fileName        String
  content         String       // the CSV text exactly as downloaded
  contentSha256   String
  entryCount      Int
  createdByUserId String
  entries         ExportBatchEntry[]
  createdAt       DateTime     @default(now())
}

model ExportBatchEntry {
  exportBatchId  String
  batch          ExportBatch  @relation(fields: [exportBatchId], references: [id], onDelete: Cascade)
  journalEntryId String
  entry          JournalEntry @relation(fields: [journalEntryId], references: [id])
  @@id([exportBatchId, journalEntryId])
  @@index([journalEntryId])
}
```

Additions: `BusinessSettings` — `booksStartDate DateTime?`, `depreciationMonthsDefault Int @default(60)`,
`depreciationSalvagePercent Int @default(0)`, `badDebtTaxRecovery String @default("UNDECIDED")`,
`lemonRepairPercent Int @default(30)`, `vendor1099ThresholdCents Int @default(200000)`,
`exportPayoutLines Json @default("{\"QBO_JOURNAL_CSV\":true,\"XERO_JOURNAL_CSV\":false,\"GENERIC_JOURNAL_CSV\":true,\"CASH_MOVEMENTS_CSV\":true}")`.
`ApplianceType` — `depreciationMonths Int?`. `Supplier` — `is1099Vendor Boolean @default(false)`, `taxIdOnFile Boolean @default(false)`
(never store the tax ID number itself).

Raw SQL: `ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amounts_check" CHECK ("debitCents" >= 0 AND "creditCents" >= 0 AND NOT ("debitCents" > 0 AND "creditCents" > 0));`

Backup/export coverage and schema health for every new table, as every batch.

### 2.1 Seeded system accounts (migration data; `systemRole` → starting name, type, description)

Assets: `BANK` Business checking (payment source) · `STRIPE_CLEARING` Stripe balance (clearing) · `UNDEPOSITED`
Cash and checks not yet deposited · `RECEIVABLES` Customer balances owed (Appliance Desk) · `RENTAL_EQUIPMENT` Rental
appliances (cost) · `ACCUM_DEPRECIATION` (CONTRA_ASSET) Rental appliances — depreciation to date.
Liabilities: `CARD` Business credit card (payment source) · `DEPOSITS_HELD` Customer deposits held · `CUSTOMER_CREDITS`
Customer account credits · `UNAPPLIED_RECEIPTS` Payments not yet matched to a bill · `SALES_TAX_UNASSIGNED` Sales tax
owed — area not yet assigned (should stay at zero). Per filing account (created when a `TaxFilingAccount` is created,
role `SALES_TAX:<filingAccountId>` / `USE_TAX:<filingAccountId>`): "Sales tax owed — <name>", "Use tax owed — <name>".
Equity: `OWNER_CONTRIBUTIONS` Owner contributions (payment source, label "Paid personally").
Income: `RENTAL_INCOME` Rental income · `LATE_RETURN_INCOME` Late-return rent · `DELIVERY_INCOME` Delivery fees ·
`INSTALLATION_INCOME` Installation fees · `REMOVAL_INCOME` Removal fees · `DAMAGE_WAIVER_INCOME` Damage waiver ·
`LATE_FEE_INCOME` Late payment fees · `EARLY_TERMINATION_INCOME` Early-ending fees · `DAMAGE_RECOVERY_INCOME` Kept from
deposits for damage · `TAX_SERVICE_FEE_INCOME` Sales tax collection allowance · `OTHER_INCOME` Other income.
Contra income: `DISCOUNTS` Discounts and waivers · `CREDITS_GIVEN` Credits given to customers · `REFUNDS` Refunds.
Expenses: `CARD_FEES` Card processing fees · `STRIPE_SERVICE_FEES` Stripe billing and service fees · `CHARGEBACKS`
Disputed payments · `BAD_DEBT` Bad debt (written off) · `DEPRECIATION` Depreciation · `DISPOSAL_LOSS` Loss on retired
appliances · `USE_TAX_EXPENSE` Use tax on purchases · `REPAIRS_PARTS` Repair parts · `TAX_ADJUSTMENTS` Sales tax
rounding and adjustments.

Seeded expense categories (each with its own EXPENSE account of the same name, owner-editable): Fuel; Vehicle repairs
and maintenance; Vehicle insurance; Business insurance; Storage / warehouse rent; Phone and internet; Software and
subscriptions; Advertising and marketing; Supplies; Small tools and equipment; Repair parts (→ `REPAIRS_PARTS`);
Professional fees (CPA, legal); Licenses and permits; Bank fees; Other. Plus "Rental appliance purchase" (→
`RENTAL_EQUIPMENT`, always capitalizes).

---

## 3. Shared primitives (new folder `src/domains/books/`)

### 3.1 Account map — `accounts.ts`

`lineKindAccountRole(kind: InvoiceLineItemKind, amountCents: number): string | "TAX_LINES" | "SKIP"` exactly:
RENTAL→`RENTAL_INCOME`; LATE_RETURN→`LATE_RETURN_INCOME`; LATE_RETURN_WAIVER→`DISCOUNTS`; DELIVERY_FEE→`DELIVERY_INCOME`;
INSTALLATION_FEE→`INSTALLATION_INCOME`; REMOVAL_FEE→`REMOVAL_INCOME`; DAMAGE_WAIVER→`DAMAGE_WAIVER_INCOME`;
LATE_FEE→`LATE_FEE_INCOME`; EARLY_TERMINATION_FEE→`EARLY_TERMINATION_INCOME`; PREPAY_DISCOUNT→`DISCOUNTS`;
CREDIT→`CUSTOMER_CREDITS`; ADJUSTMENT→`OTHER_INCOME` if positive else `DISCOUNTS`; TAX→`"TAX_LINES"`; DEPOSIT→`"SKIP"`
(K-A4 guarantees none exist). `async function accountIdForRole(tx, role)` caches per request; a missing role throws.

### 3.2 Posting rules — `posting-rules.ts` (pure; one function per event; returns `{ entryDate, memo, lines[] }` or `null`)

Debits equal credits in every result (assert in the function; a test proves it for every rule).

| eventKind | Source | Date | Debit | Credit |
|---|---|---|---|---|
| `INVOICE_RECOGNIZED` | Invoice not DRAFT | `billingPeriodStart ?? createdAt` | `RECEIVABLES` = `amountDueCents`; contra accounts for negative lines | income per line (3.1); `SALES_TAX:<acct>` per `InvoiceTaxLine.taxCents` grouped by filing account (no tax lines but a TAX item → `SALES_TAX_UNASSIGNED`) |
| `INVOICE_VOIDED` | Invoice VOID that was recognized | void date | mirror of recognition | mirror |
| `RECEIPT_RECEIVED` | Receipt | `receivedOn` | `STRIPE_CLEARING` (STRIPE) / `UNDEPOSITED` (MANUAL) | `UNAPPLIED_RECEIPTS` |
| `PAYMENT_APPLIED` | Payment with money-arrived status and a receipt | payment `createdAt` | `UNAPPLIED_RECEIPTS` | `RECEIVABLES` |
| `DEPOSIT_FUNDED` | Deposit with `sourceReceiptId` | receipt date | `UNAPPLIED_RECEIPTS` | `DEPOSITS_HELD` |
| `CREDIT_FROM_RECEIPT` | CustomerCredit whose source is a receipt overpayment | credit `createdAt` | `UNAPPLIED_RECEIPTS` | `CUSTOMER_CREDITS` |
| `CREDIT_GRANTED` | any other CustomerCredit (goodwill, late delivery, refund-to-credit) | `createdAt` | `CREDITS_GIVEN` (refund-to-credit: `REFUNDS`) | `CUSTOMER_CREDITS` |
| `CREDIT_APPLIED` | CreditApplication | `createdAt` | `CUSTOMER_CREDITS` | `RECEIVABLES` |
| `REFUND_ISSUED` | Refund | `createdAt` | `REFUNDS` (non-tax part) + `SALES_TAX:<acct>` (tax part, D-K10) | `STRIPE_CLEARING` if `stripeRefundId` else `BANK` |
| `DEPOSIT_REFUNDED` | Deposit `refundedAt` | `refundedAt` | `DEPOSITS_HELD` (`refundedAmountCents`) | `STRIPE_CLEARING` if `stripeRefundId` else `BANK` |
| `DEPOSIT_RETAINED` | Deposit refunded for less than amount | `refundedAt` | `DEPOSITS_HELD` (amount − refunded) | `DAMAGE_RECOVERY_INCOME` |
| `INVOICE_WRITTEN_OFF` | Invoice `writtenOffAt` | `writtenOffAt` | `BAD_DEBT` (+ `SALES_TAX:<acct>` tax part only if recovery YES) | `RECEIVABLES` (open balance) |
| `STRIPE_FEE` | balance txn with `feeCents ≠ 0` | `createdAtStripe` | `CARD_FEES` | `STRIPE_CLEARING` |
| `STRIPE_SERVICE_FEE` | balance txn type `stripe_fee` / `tax_fee` / `application_fee` charged to Chris | same | `STRIPE_SERVICE_FEES` | `STRIPE_CLEARING` |
| `STRIPE_DISPUTE` | type `adjustment` with reporting category `dispute` or `dispute_reversal` | same | `CHARGEBACKS` (reversal: credit) | `STRIPE_CLEARING` (reversal: debit) |
| `STRIPE_PAYOUT` | type `payout` (and `payout_failure` reversed) | same | `BANK` | `STRIPE_CLEARING` |
| `EXPENSE_POSTED` | Expense POSTED | `spentOn` | category account, or `RENTAL_EQUIPMENT` if capitalized | paid-from account |
| `EXPENSE_VOIDED` | Expense VOID after posting | `voidedAt` | mirror | mirror |
| `APPLIANCE_CONTRIBUTED` | Appliance with cost and **no** capitalized expense linked | `purchaseDate ?? createdAt` (not before `booksStartDate`; earlier → `booksStartDate`) | `RENTAL_EQUIPMENT` | `OWNER_CONTRIBUTIONS` |
| `DEPRECIATION:<YYYY-MM>` | Appliance, one per month | last day of month | `DEPRECIATION` | `ACCUM_DEPRECIATION` |
| `APPLIANCE_RETIRED` | Appliance retired/archived | that date | `ACCUM_DEPRECIATION` (to date) + `DISPOSAL_LOSS` (rest) | `RENTAL_EQUIPMENT` (cost) |
| `USE_TAX_ACCRUED` | PurchaseUseTax with due > 0 | `purchasedOn` | `USE_TAX_EXPENSE` | `USE_TAX:<acct>` |
| `TAX_FILED` | TaxFilingPeriod FILED | `filedOn` | `SALES_TAX:<acct>` (worksheet sales tax) + `USE_TAX:<acct>` (worksheet use tax) | `BANK` (`amountPaidCents`) + `TAX_SERVICE_FEE_INCOME` (fee retained); any remainder to `TAX_ADJUSTMENTS` (either side) |

Stripe charge/payment balance transactions themselves post nothing (the receipt already did); only their fee does.
`INVOICE_RECOGNIZED` refuses (returns a problem, not an entry) when its lines plus tax lines do not equal
`amountDueCents`; the poster turns that into an exception card with both numbers.

### 3.3 Poster — `post.ts`

```ts
export async function postPending(opts?: { limit?: number }): Promise<{ posted: number; problems: { sourceType: string; sourceId: string; message: string }[] }>;
export async function postForSource(tx, sourceType: JournalSourceType, sourceId: string): Promise<void>; // used by tests and the poster
```

For each source type, query records at or after `booksStartDate` that lack the entry for each applicable `eventKind`
(anti-join on the unique key), oldest first, at most `limit` (default 500) per run. Each entry is written in its own
transaction; a unique-constraint violation means another run posted it — skip silently. Period rule D-K6 applied when
choosing `entryDate`. Problems never stop the run; each becomes an exception card (dedupe by source). `booksStartDate`
null → nothing posts and the Books screen asks the owner to set it (starting suggestion: the first day of the month of
the first real customer invoice, or launch day).

### 3.4 Stripe sync — `stripe-balance.ts`

`syncStripeBalanceTransactions()`: `stripe.balanceTransactions.list({ created: { gte: cursor - 3 days }, limit: 100 })`
paging with `starting_after`, upserting by id (the 3-day overlap makes missed pages harmless), cursor = newest
`created` seen. `checkStripeClearing()`: clearing account balance vs `stripe.balance.retrieve()` (available + pending,
USD); difference ≥ 1 cent → exception card "Stripe balance and your books differ by $X" with a link to the last 30 days
of Stripe transactions. Both run in automation `books-nightly` (cron `"40 9 * * *"`, after the backup), followed by
`postPending`. Test mode keys only until the owner turns on live payments (hard limit unchanged).

### 3.5 Expenses — `expenses.ts`

```ts
export async function submitExpense(actorUserId: string, input: ExpenseInput): Promise<{ id: string }>; // STAFF+: status SUBMITTED (STAFF) or POSTED (OWNER/ADMIN, unless saveAsDraft)
export async function postExpense(actorUserId: string, id: string, version: number): Promise<void>;     // OWNER/ADMIN
export async function voidExpense(actorUserId: string, id: string, version: number, reason: string): Promise<void>; // OWNER/ADMIN
export async function createDueRecurringExpenses(now: Date): Promise<number>; // creates DRAFT expenses; in books-nightly
```

zod-validated input; amounts integer cents > 0; vendor tax ≤ amount; posting row-locks the expense (`SELECT … FOR
UPDATE`) and re-checks the actor (`assertActiveTeamActor`), version check for concurrent edits. On posting:
capitalized → set `Appliance.acquisitionCostCents` if null (never overwrite a different value — show a message); call
Batch T's `recordUseTaxForPurchase` (`sourceType "EXPENSE"`, `isRentalInventory` = capitalized). Voiding reverses use tax
unless filed (T's rule).

### 3.6 Exports — `exports/` (one pure formatter per target + `run-export.ts`)

```ts
export async function runExport(actorUserId: string, input: { target: ExportTarget; mode: ExportMode; from: Date; to: Date; onlyNotYetExported: boolean }): Promise<{ batchId: string } | { blocked: string[] }>; // OWNER/ADMIN
```

Steps: `postPending`; load entries in range (Colorado dates, inclusive) ordered by `entryDate, entryNumber`; skip
`STRIPE_PAYOUT` entries when `exportPayoutLines[target]` is false; blocked if any used account lacks a mapping for the
target; group (DAILY_SUMMARY: per `entryDate`, sum debits and credits per account, net each account to one side;
DETAIL: per entry); format; store `ExportBatch` + entries; return. All amounts formatted with
`formatCentsAsPlainDecimal`; text cells pass through `src/lib/csv.ts` (formula-injection safe).

- **QBO_JOURNAL_CSV**: header `Journal No,Journal Date,Account,Debits,Credits,Description`; date `MM/DD/YYYY`; Journal No
  `AD-YYYYMMDD` (summary) or `AD-<entryNumber>` (detail); Description = memo (summary: "Appliance Desk daily summary").
  QuickBooks' import screen lets the user match columns, so the owner guide shows the matching step.
- **XERO_JOURNAL_CSV**: header `*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount`; date `MM/DD/YYYY` (Xero
  reads dates in the organisation's region format; Chris's is US); Amount positive = debit, negative = credit; TaxRate =
  mapping's `externalTaxRate` (sales tax is already its own liability account, so lines are "Tax Exempt").
- **GENERIC_JOURNAL_CSV**: `Entry,Date,Account,Debit,Credit,Memo,Source` (ISO dates).
- **CASH_MOVEMENTS_CSV**: one row per journal line touching a payment-source or clearing account:
  `Date,Account,Description,Amount,Category` where Category is the other side's account name (multi-line entries: one
  row per other-side line, split with `allocateAcrossLines`).

The owner guide includes "Test the import on a trial company first" with screenshots-free written steps; the PR records
that the formats were checked against each vendor's published import instructions (cite URLs) and that the owner's
trial import is still to do (go-live line).

### 3.7 Depreciation — `depreciation.ts` (pure schedule + posting via 3.2)

`monthlySchedule({ costCents, salvagePercent, months, startMonth }): { periodKey: string; amountCents: number }[]` —
`depreciable = cost − round(cost × salvage / 100)`; equal `floor(depreciable / months)`, last month gets the remainder.
The poster creates `DEPRECIATION:<YYYY-MM>` entries for every month that has ended, up to the retirement month.
Changing the useful life affects only months not yet posted (recompute the remaining amount over the remaining months).

### 3.8 Reports — `reports.ts` (each number registered in `METRICS` with its definition)

- `profitAndLoss({ from, to, basis: "ACCRUAL" | "CASH", compare: "PREVIOUS_PERIOD" | "SAME_PERIOD_LAST_YEAR" | null })`:
  rows grouped Income / Less: discounts, credits, refunds / Expenses by account; totals; net profit; each cell drills to
  the entries.
- `balanceSnapshot(asOf)`: cash (bank, clearing, undeposited), customer balances owed, deposits held, customer credits,
  tax owed per filing account, rental appliances at cost less depreciation, owner contributions, profit to date.
- `appliancePayback()`: per appliance — cost, rent invoiced (RENTAL and LATE_RETURN lines split equally across
  appliances assigned to that rental line on the line's period start — reuse the assignment logic in
  `src/domains/inventory/analytics.ts`), repairs (job parts + labor + expenses linked to the appliance), net, book value,
  months to pay back at the last-6-months average, "costs more than it earns" flag when repairs > `lemonRepairPercent`
  of rent over the last 12 months.
- `cashForecast(days = 90)`: ESTIMATE — next bill dates of live subscriptions (monthly line totals + `computeTax`),
  recurring expenses, tax returns due (open periods' worksheet totals); never presented as actual.
- `customerHealth()`: rentals ending per month, average rental length, collected net per customer, by lead source where
  the lead link exists.
- `yearEndPackage(year)`: downloadable CSVs — P&L by month (accrual and cash), asset register with depreciation, sales and
  use tax filed per account, payments to suppliers marked 1099 vendors at or above `vendor1099ThresholdCents`
  (starting value $2,000 — the federal threshold for payments made from 2026; CPA confirms), expenses by category.

---

## 4. Screens (Desk → Money → **Books**; plus Expenses for staff)

1. **Profit & loss** (default tab) — month picker, accrual/cash switch with plain explanation, comparison column, drill-down.
2. **Expenses** — list, filters, "Add expense" (phone-first: amount, vendor, category, photo; more fields folded), submitted
   queue for owner/admin, recurring templates. Staff see **My expenses** under their menu (submit and view own only).
3. **Balance** — the snapshot with explanations of each line.
4. **Appliance payback**, **Cash forecast**, **Customers** — the reports in 3.8.
5. **Export** — target, mode, date range, "only entries not exported yet", history of exports with re-download; blocked
   message lists unmapped accounts with a link.
6. **Accounts** (OWNER edits) — chart of accounts with plain descriptions, the per-target mapping table ("What is this
   account called in your QuickBooks?"), months (close/re-open), book settings (start date, depreciation, write-off tax,
   lemon threshold, 1099 threshold, payout lines per target) each explained on screen with starting value and restore.
7. The old Reports "Accounting export" button links to Export with a note; the old CSV route keeps working until Batch K's
   PR removes it (ROADMAP line) — do not delete it in this batch.

---

## 5. Work units (one PR per group; stacked)

**PR K-1:** WU-K1 migration + seeds; WU-K2 account map + posting rules (pure); WU-K3 poster, periods, integrity check.
**PR K-2:** WU-K4 Stripe sync + clearing check; WU-K5 expenses, recurring, receipt photo, use-tax hook, staff submission.
**PR K-3:** WU-K6 exports + accounts/mapping screen; WU-K7 depreciation. **PR K-4:** WU-K8 P&L, balance, payback;
WU-K9 forecast, customers, year-end. **PR K-5:** WU-K10 docs.

Named tests (real Postgres where marked ★):

- WU-K1 ★ `tests/books-migration-integration.test.ts` — seeds, check constraint rejects a two-sided line, defaults.
- WU-K2 `tests/books-posting-rules.test.ts` — every row of 3.2 balances; invoice with discount, credit line and two tax
  areas; refund tax split; write-off with recovery YES/UNDECIDED; mismatch refuses.
- WU-K3 ★ `tests/books-poster-integration.test.ts` — posts each source once (run twice = no duplicates; two concurrent
  runs = no duplicates); closed month → next open month with `lateForDate`; `booksStartDate` respected; problem →
  exception card; nightly integrity check flags an unbalanced entry inserted by raw SQL.
- WU-K4 ★ `tests/books-stripe-sync-integration.test.ts` — fake client pages, overlap upsert, fee/payout/dispute/service
  fee posting, unknown type stored and carded, clearing mismatch card.
- WU-K5 ★ `tests/books-expenses-integration.test.ts` — STAFF submit/own-only visibility, ADMIN post, version conflict,
  void reverses, capitalize sets cost once, use tax row written; `tests/books-recurring.test.ts`.
- WU-K6 `tests/books-exports.test.ts` — byte-identical re-export; summary nets per account and balances per day;
  detail mode; payout toggle; unmapped accounts block; formula-injection cell; each target's header and date format.
- WU-K7 `tests/books-depreciation.test.ts` — schedule sums to depreciable amount; life change mid-way; retirement entry.
- WU-K8/9 `tests/books-reports.test.ts` and ★ `tests/books-reports-integration.test.ts` — P&L accrual vs cash on the same
  data; comparison column; payback split for a two-appliance line; forecast labelled ESTIMATE; 1099 threshold.
- Browser `e2e/books.spec.ts` (assign a shard): owner adds an expense with photo on phone width, runs a QBO export, sees
  P&L; STAFF sees only My expenses; axe clean light/dark.

---

## 6. Cheap-model guardrails

- Never change billing code to "post as you go" — the poster reads records (D-K2).
- Every posting rule is pure and tested for balance; never build lines inside Prisma queries.
- Never hard-code an account *id*; look up by `systemRole`.
- Dates: business date in America/Denver; month boundaries with `src/lib/business-date.ts`; DST tests for an entry at
  23:30 Denver on the last day of a month.
- No external accounting API calls in this batch.

## 7. Go-live lines (verbatim, `docs/GO-LIVE-CHECKLIST.md` → new "Books" section)

- "Books: start date set; every account used so far is mapped to your accounting software's account name."
- "Books: your bookkeeper (or you) imported one month's file into a trial QuickBooks/Xero company and it balanced."
- "Books: CPA answered IN-39 (tax on written-off bills) and confirmed the depreciation starting values are fine for
  management numbers."

## 8. Stop-and-ask points

- **S-K1** An invoice carries a DEPOSIT line (K-A4). **S-K2** A CREDIT line has no CustomerCredit behind it (K-A5).
- **S-K3** Uploads cannot store a standalone receipt photo (K-A8).
- **S-K4** A Stripe balance transaction type not named in 3.2 appears in test data — list it; do not invent a rule.
- **S-K5** `INVOICE_RECOGNIZED` mismatches appear for invoices created by existing code paths (a real data-model gap).
- **S-K6** Selling a retired appliance (proceeds) or manual journal entries are requested — out of scope.
- **S-K7** Any accounting-software import format cannot be confirmed from the vendor's public documentation.

## 9. Later phase (NOT approved by this design): direct QuickBooks Online sync

Outline only, for a future design refresh: an Intuit developer app (Chris creates it; Builder tier, $0); OAuth 2.0
authorization-code flow with the refresh token encrypted at rest (new `ENCRYPTION_KEY` env var); create one QBO
`JournalEntry` per exported day using the same summary lines and the `requestid` idempotency parameter; store the QBO
id per day; never read more than needed (reads are metered); owner switch, default OFF; a sync failure never blocks the
app. Revisit once the file export has been used for at least one quarter.

## 10. What later batches must assume

- Report numbers about money come from the journal (`JournalLine`), not from re-adding invoices.
- Expenses exist and carry use tax; Batch O's approvals can gate `postExpense` and refunds without changing posting.
