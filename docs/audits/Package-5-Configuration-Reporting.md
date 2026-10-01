# Package 5 Audit — Business Configuration & Reporting

**Audit date:** 2026-10-01  
**Repository:** `christcr2012/appliance-desk`  
**Audited branch:** `main`  
**Audited commit:** `851f31931f9b7cb3a300d4eaa580e78cb16d7dae`  
**Scope authority:** `docs/AUDIT_ROADMAP.md` Package 5  
**Status:** Audit complete; remediation not yet implemented by this report.

---

## Executive summary

Package 5 covers business-settings persistence and validation, dashboard correctness, financial/reporting semantics, accounting export completeness, large-dataset behavior, and historical configuration integrity.

The current codebase has several strong foundations that should be preserved. `updateBusinessSettings()` writes the singleton settings row and its audit entry in one transaction. Section-specific settings saves whitelist the fields that belong to the selected section, so an old browser form cannot overwrite unrelated settings. The newer `/desk/revenue` work is particularly careful: it labels MRR/ARR as estimates, labels payment totals as **gross invoice payments**, keeps refunds separate, uses a repeatable-read snapshot for paginated payment/refund records, and has a real Postgres integration test proving payment/refund record behavior.

The main risk is that the older `/desk/reports` and generic accounting-export layer do **not** maintain the same semantic discipline. The most important defects are:

- the agreement “actual vs. estimated” report compares recurring rental-rate accrual against gross invoice `amountPaidCents`, even though those invoice payments can include deposits, damage-waiver charges, tax, late fees and other non-rent amounts;
- recorded refunds do not reduce the report’s “Actually collected” figure, so refunded money can still make an agreement look financially current;
- the estimate side uses a fixed 30-day proration model even though the product bills monthly on an anniversary schedule, so a healthy agreement can develop a synthetic “gap” merely because calendar months are not all 30 days;
- manual overpayments are only partly represented as `Payment` rows — the cash applied to invoices is recorded, while the excess becomes `CustomerCredit`, causing the generic accounting export and gross-payment reporting to omit real cash that was received;
- accounting/export dates represent application record time rather than a reliable provider settlement or owner-entered received date, and the CSV truncates timestamps to a UTC calendar date;
- the Reports page, accounting export, and Dashboard contain unbounded full-history/fleet calculations that will become progressively more expensive as the business grows;
- the report that claims to show repairs missing logged cost only flags jobs where **both** parts and labor are null, despite the fleet analytics correctly considering a repair incomplete when **either** cost is missing.

### Overall assessment

**HIGH RISK until remediation.**

No Package 5 issue was assigned Critical severity. The financial reports are misleading enough to affect business decisions and bookkeeping, but the exact invoice/payment/refund records still exist and the newer revenue-record views are substantially more precise. The remediation should correct the reporting layer rather than reconstruct the billing ledger from scratch.

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 7 |
| Medium | 5 |
| **Total** | **12** |

---

# Audit scope

The audit followed Package 5 in `docs/AUDIT_ROADMAP.md` and reviewed:

- `BusinessSettings` persistence, defaults, validation and audit behavior;
- section-specific settings saves and stale-form protection;
- catalog/product settings mutations;
- Dashboard counts and financial/fleet metrics;
- `/desk/revenue` and its underlying revenue-record queries;
- `/desk/reports` earnings reconciliation and repair-cost completeness;
- generic accounting CSV export;
- payments, refunds, deposits, manual payments and customer credits as reporting inputs;
- reporting date/period semantics;
- report pagination/bounding and fleet analytics cost;
- lead-source reporting;
- tests proving or failing to prove those behaviors;
- overlaps with Packages 1–4 so findings are not double-counted.

Primary code reviewed included:

```text
src/domains/settings/index.ts
src/domains/settings/form-schema.ts
src/domains/settings/sections.ts
src/domains/settings/section-config.ts
src/app/desk/settings/actions.ts
src/app/desk/settings/page.tsx
src/app/desk/settings/settings-form.tsx
src/domains/reports/index.ts
src/domains/reports/earnings.ts
src/domains/reports/accounting-export.ts
src/app/desk/reports/page.tsx
src/app/desk/reports/export/route.ts
src/domains/dashboard/index.ts
src/app/desk/dashboard/page.tsx
src/domains/billing/index.ts
src/domains/billing/revenue.ts
src/domains/billing/revenue-records.ts
src/domains/billing/manual-payments.ts
src/domains/billing/webhooks.ts
src/domains/billing/checkout.ts
src/domains/inventory/index.ts
src/domains/inventory/analytics.ts
src/domains/jobs/index.ts
src/domains/leads/index.ts
prisma/schema.prisma
tests/reports.test.ts
tests/reports-earnings.test.ts
tests/accounting-export.test.ts
tests/revenue-records-integration.test.ts
```

---

# Critical findings

## No confirmed Critical findings

The audit did not identify a Package 5 issue that currently warrants Critical severity.

The exact underlying billing records are still present, `/desk/revenue` already distinguishes gross payments from refunds, and the current problems can be corrected by changing reporting/accounting projections and configuration mutation boundaries rather than repairing widespread lost data.

---

# High findings

## H1 — The agreement earnings report compares different financial bases

**Severity:** High  
**Primary files:**

```text
src/domains/reports/index.ts
src/domains/reports/earnings.ts
src/app/desk/reports/page.tsx
src/domains/billing/webhooks.ts
```

### Problem

`getEarningsReport()` calculates the estimated side from:

```text
sum(RentalLine.monthlyPriceCents) × elapsed days / 30
```

That is a recurring **rental-rate-only** estimate.

The actual side is:

```text
sum(Invoice.amountPaidCents)
```

for every invoice attached to the agreement.

Those two bases are not comparable. Real invoice payments can contain more than recurring rent. The current billing/webhook code can record invoice line items such as:

```text
RENTAL
DEPOSIT
DAMAGE_WAIVER
TAX
LATE_FEE
CREDIT / ADJUSTMENT and other invoice kinds where applicable
```

Signing payments in particular can contain the security deposit and damage waiver before recurring rent begins. A later recurring invoice can include tax. A delinquent invoice can acquire a late fee.

The Reports page then labels the total `actualCents` as **“Actually collected”** and subtracts it from a rental-rate estimate.

### Failure example

Suppose the agreed rent accumulated to $120, while the customer paid:

```text
$80 rent
$30 security deposit
$10 damage waiver
```

The report sees $120 “actual” and can present a $0 gap even though only $80 of rental consideration was collected against the $120 rental-rate basis.

### Why this matters

The report is explicitly intended to answer whether agreements are “falling behind their own pricing.” Non-rental cash must not mask a rental shortfall.

### Required remediation

Choose one consistent basis and name it precisely.

Preferred approach:

1. Treat Invoice/InvoiceLineItem/Payment/Refund as the financial source of truth.
2. For a **rent reconciliation**, allocate paid/refunded value to the invoice line kinds that belong to rent, rather than using entire invoice `amountPaidCents`.
3. Alternatively, create a broader **expected charges vs. net collected** report in which both sides include the same categories.
4. Keep deposits separate from revenue because a refundable security deposit is a liability, not earned rent.
5. Show tax separately from business revenue.
6. Keep report DTO names explicit: e.g. `expectedRentCents`, `grossRentPaymentsCents`, `rentRefundsCents`, `netRentCollectedCents`.

Do not “fix” this merely by renaming `actualCents`; the arithmetic must use comparable categories.

### Required tests

Add real ledger-shaped tests for:

- rent-only invoice;
- rent + tax;
- rent + deposit;
- signing-only deposit/waiver invoice;
- rent + late fee;
- partial payment across multiple line kinds;
- manual payment;
- credits/adjustments;
- no non-rent charge can make a rental-rate shortfall disappear.

---

## H2 — Refunds do not reduce `/desk/reports` “Actually collected”

**Severity:** High  
**Primary files:**

```text
src/domains/reports/index.ts
src/app/desk/reports/page.tsx
src/domains/billing/webhooks.ts
prisma/schema.prisma
```

### Problem

`getEarningsReport()` sums `Invoice.amountPaidCents` and never reads `Refund` rows.

Refunds are represented separately in the billing ledger. Recording a refund does not rewrite history by pretending the original payment never happened — correctly, the original paid invoice/payment remains and a Refund row records the outflow.

That means `Invoice.amountPaidCents` is a **gross paid amount**, not net retained cash after refunds.

The Reports page nevertheless labels that value “Actually collected” and describes it as what was actually paid/processed, without subtracting recorded refunds.

### Failure example

```text
Invoice paid:     $100
Later refund:      $60
Net retained:      $40
Reports “actual”: $100
```

The refunded $60 can therefore continue to make the agreement look current.

### Required remediation

If the report intends to show retained collections, calculate:

```text
relevant succeeded payments
- relevant recorded refunds
= net retained collections
```

and use the same charge-category basis selected for H1.

If the product also needs gross collections, expose it as a separate explicitly labeled figure rather than using one number for both meanings.

### Required tests

- full refund;
- partial refund;
- multiple refunds;
- refund after an earlier reporting period;
- refunded deposit must not be confused with rent refund;
- gross and net figures remain independently reconcilable to source rows.

---

## H3 — Fixed 30-day earnings proration does not match the product’s real monthly billing schedule

**Severity:** High  
**Primary files:**

```text
src/domains/reports/earnings.ts
src/domains/reports/index.ts
src/app/desk/reports/page.tsx
src/domains/billing/checkout.ts
```

### Problem

`computeEstimatedEarningsCents()` reconstructs expected earnings by dividing the agreed monthly rate by 30 and multiplying by elapsed days.

The real product does not bill daily on a 30-day accounting basis. It uses monthly/anniversary recurring billing through Stripe.

Calendar months vary from 28 to 31 days. As time passes, a perfect monthly payer can therefore appear ahead or behind this synthetic 30-day curve even though every real invoice was paid exactly as billed.

### Why this matters

The Reports page uses a $10 gap threshold and tells the owner that agreements above it are “falling behind.” A mathematical convention that does not match the actual invoice schedule can create false collection warnings.

### Required remediation

Do not reconstruct receivables from elapsed days when the application already owns the invoice ledger.

For collections/reconciliation, prefer:

```text
real invoices issued/due through asOf
minus payments/refunds/credits on the same basis
```

If a forward-looking accrual estimate is still useful, label it as an estimate and derive it from calendar billing anniversaries rather than a fixed 30-day divisor.

### Required tests

Cover:

- February/non-leap and leap-year months;
- 31-day months;
- billing anniversary on the 29th/30th/31st;
- a customer who pays every generated invoice exactly should never appear delinquent solely due to day-count math;
- ended agreements stop at the correct billing boundary.

---

## H4 — Manual overpayment cash is omitted from the accounting export and gross-payment reports

**Severity:** High  
**Primary files:**

```text
src/domains/billing/manual-payments.ts
src/domains/reports/accounting-export.ts
src/domains/billing/revenue-records.ts
prisma/schema.prisma
```

### Problem

`recordManualPayment()` accepts one real payment amount. It applies that amount to open invoices. For each applied portion it creates a `Payment` row.

If money remains after every open invoice is satisfied, the remainder becomes a `CustomerCredit` row.

No `Payment` or equivalent cash-receipt row is created for that excess.

Example:

```text
Customer hands business a $100 check
Open invoices total $80
Payment rows created: $80
CustomerCredit created: $20
Real cash received: $100
```

`getAccountingTransactions()` claims to export every real money movement, but it reads succeeded `Payment`, `Refund`, and refunded `Deposit` rows. The $20 excess above never appears as an incoming cash transaction.

The newer revenue-record screens similarly sum succeeded `Payment` rows, so their otherwise-careful “gross invoice payment” number correctly reports invoice-applied cash but not total manual cash received.

### Required remediation

Separate **cash receipt identity** from **application/allocation**.

A robust design is:

```text
CashReceipt / PaymentReceipt
  total received
  receivedAt
  method/reference
  provider/manual identity
  customer

PaymentApplication
  receiptId
  invoiceId
  applied amount

CustomerCredit
  receiptId/source
  unapplied amount
```

A lighter migration can still work if `Payment` is retained as the receipt model, but one durable row must represent the full amount received and invoice allocations must not duplicate it as independent cash receipts.

### Required tests

- exact-payment manual receipt;
- overpayment receipt;
- one check spread across several invoices;
- full cash received equals export inflow;
- unapplied customer credit does not disappear or double-count;
- later application of an existing credit does not create another incoming cash movement.

---

## H5 — Accounting dates are record timestamps, not reliable transaction/settlement dates

**Severity:** High  
**Primary files:**

```text
src/domains/billing/manual-payments.ts
src/domains/billing/webhooks.ts
src/domains/reports/accounting-export.ts
src/app/desk/reports/export/route.ts
src/domains/billing/revenue.ts
```

### Problem

The generic accounting export uses `Payment.createdAt` and `Refund.createdAt` as the transaction date.

For Stripe rows, those are application-record timestamps created when the webhook is processed, not necessarily the provider’s settlement/effective date.

For manual payments, the owner cannot enter the date the check/cash/bank transfer was actually received. `recordManualPayment()` creates the row at the time it is entered into Appliance Desk.

The CSV then reduces that timestamp further to:

```text
t.date.toISOString().slice(0, 10)
```

which is the UTC calendar date, not the Colorado business date.

A payment entered later than it was received, a delayed webhook, or a near-midnight Mountain-time event can therefore land in the wrong accounting day/month.

### Why this matters

This file is explicitly meant for a bookkeeper/accounting import. Period correctness matters more here than on a casual operational timeline.

### Required remediation

Persist explicit financial dates:

- manual `receivedAt` selected by OWNER/ADMIN (defaulting to now but editable at entry);
- provider event/payment effective timestamp where Stripe supplies it;
- keep `createdAt` as “recorded in Appliance Desk,” not the accounting date;
- export the effective transaction date plus optionally the recorded timestamp;
- choose and document one timezone/calendar rule for bookkeeping output.

### Required tests

- manual payment entered today for a check received yesterday;
- Mountain-time late-night transaction crossing UTC midnight;
- delayed Stripe webhook;
- historical period filtering uses the intended financial date;
- CSV and on-screen report use the same documented basis.

---

## H6 — `/desk/reports` and the accounting export are unbounded all-history reads

**Severity:** High  
**Primary files:**

```text
src/domains/reports/index.ts
src/domains/reports/accounting-export.ts
src/app/desk/reports/page.tsx
src/app/desk/reports/export/route.ts
```

### Problem

`getEarningsReport()` loads every agreement that has ever started billing, every selected rental line for those agreements, and every invoice’s paid amount into application memory. It then sorts every agreement in JavaScript.

`getJobsMissingRepairCost()` returns every matching repair with no pagination.

`getAccountingTransactions()` reads **all** succeeded payments, **all** refunds, and **all** refunded deposits in a repeatable-read transaction, materializes them into one array, sorts the entire array in memory, then the route serializes the full result into one response string.

The UI similarly renders every notable agreement row and every missing-cost repair row.

### Why this matters

The export/report is precisely where history accumulates forever. `take` limits do not exist here. Growth in invoices and payments will increase memory, query time, transaction duration, server response size and function execution time on every export/report request.

### Required remediation

For interactive reports:

- use count/sum aggregates in SQL;
- page row detail with deterministic cursor or stable offset ordering;
- query only the period required by the report;
- avoid loading nested all-history invoice arrays when SQL can aggregate by agreement.

For accounting export:

- support a required/recommended date range;
- stream or chunk output instead of materializing every transaction;
- use a single ordered database projection/UNION where practical;
- preserve repeatable/snapshot semantics for a single export run;
- enforce sensible export size controls with a clear user-facing path for larger ranges.

### Required tests

Add realistic capacity tests with thousands/tens of thousands of rows that verify bounded memory/query behavior and complete pagination/export coverage.

---

## H7 — The main Dashboard computes full-fleet profitability history just to display one utilization percentage

**Severity:** High  
**Primary files:**

```text
src/domains/dashboard/index.ts
src/domains/inventory/index.ts
src/domains/inventory/analytics.ts
src/app/desk/dashboard/page.tsx
```

### Problem

`getDashboardStats()` calls `getFleetAnalytics()` only to use:

```text
fleet.totals.averageUtilizationFraction
```

`getFleetAnalytics()` is intentionally a whole-fleet analytical routine. On every call it loads:

- every non-archived appliance;
- every appliance assignment in the database with rental-line pricing;
- every completed maintenance-visit `JobAppliance` history;
- then builds several in-memory maps and calculates profitability/utilization for every appliance.

The function’s own comment states that pagination bounds the Fleet report UI, **not the underlying fleet calculation**.

That cost is reasonable when the owner intentionally opens the Fleet analytics report. It is disproportionately expensive for the default Dashboard just to show one percentage.

### Required remediation

Create a lightweight dashboard-specific utilization query/aggregate.

Options:

- compute current fleet-status utilization directly from counts if that is the intended Dashboard metric; or
- compute the documented lifetime/rolling utilization from a database aggregation/materialized summary rather than reconstructing full per-appliance profitability.

Do not call full profitability analytics from the Dashboard merely to obtain one scalar.

### Required tests

- Dashboard query count/shape remains bounded as assignment/repair history grows;
- Dashboard utilization semantics are explicitly documented;
- Fleet report retains its detailed full analytics independently;
- large fixture test proves Dashboard does not load every historical repair/assignment row into application memory.

---

# Medium findings

## M1 — “Repairs missing a logged cost” misses partially-entered repair costs

**Severity:** Medium  
**Primary files:**

```text
src/domains/reports/index.ts
src/domains/exceptions/index.ts
src/domains/inventory/index.ts
src/domains/inventory/analytics.ts
```

### Problem

The Reports query flags a repair only when:

```text
partsCostCents = null
AND
laborCostCents = null
```

The owner UI/domain deliberately treats a blank field as **unknown**, not as zero.

Fleet analytics correctly marks a repair as incomplete when:

```text
partsCostCents === null OR laborCostCents === null
```

and prevents an appliance with an incomplete repair cost from being represented as having definitively paid for itself.

The Reports page can therefore say:

> Every completed repair has a cost logged.

when a completed repair has a parts cost but no labor cost, or vice versa.

The exception inbox currently shares the same both-null predicate, so this is one shared correctness defect, not two findings.

### Required remediation

Use the canonical incomplete-cost rule everywhere:

```text
partsCostCents IS NULL OR laborCostCents IS NULL
```

If `0` is intentionally known/no-cost, retain explicit zero as complete.

### Required tests

- both missing -> flagged;
- parts missing/labor entered -> flagged;
- labor missing/parts entered -> flagged;
- explicit `0` + explicit `0` -> complete;
- explicit one-side zero + other-side amount -> complete.

---

## M2 — Several catalog/settings mutations can commit without their audit record

**Severity:** Medium  
**Primary file:**

```text
src/domains/settings/index.ts
```

### Problem

`updateBusinessSettings()` correctly writes settings state and audit together inside one transaction.

Several catalog configuration mutations do not follow that pattern:

- `setAppliancePhotoUrl()` updates the appliance type, then writes audit separately;
- `setApplianceVisibility()` updates, then audits separately;
- `createApplianceType()` creates the row, then audits separately;
- `setApplianceTypeActive()` changes active/public state, then audits separately.

If the audit insert fails after the business mutation succeeds, the caller can receive an error while the website/catalog has already changed and the owner’s change history is incomplete.

### Required remediation

Use one transaction for each database-only catalog mutation and its audit record.

For creation, also return the created row from that transaction. Preserve public-site revalidation only after commit.

This finding does **not** duplicate Package 2’s price-history race: `updateAppliancePrice()` has its own concurrency issue already tracked there.

### Required tests

Inject audit failure against real Postgres and prove the corresponding catalog change rolls back for each mutation.

---

## M3 — Missing `BusinessSettings` silently falls back to public placeholder values

**Severity:** Medium  
**Primary file:**

```text
src/domains/settings/index.ts
```

### Problem

If the singleton row is missing, `getBusinessSettings()` returns `DEFAULT_SETTINGS` containing values such as:

```text
[Company Name]
[Phone Number]
[Email Address]
[Business Address]
```

The comment describes this as a resilience fallback if the seeded singleton somehow disappears.

For an internal development environment that is convenient. In production, silently continuing can publish placeholder identity/contact information and conceal the fact that a core configuration row was deleted or never provisioned.

### Required remediation

Fail visibly in production rather than silently presenting fake-but-valid-looking business configuration.

Recommended behavior:

- production public pages: safe maintenance/configuration-required state without placeholder contact claims;
- owner desk: explicit critical settings warning and repair path;
- nonproduction/tests may retain deterministic fallback if useful;
- startup/health check should verify the singleton exists.

Do not auto-create settings during ordinary page reads.

### Required tests

- production missing singleton cannot render placeholder public business identity;
- owner receives actionable configuration error;
- nonproduction behavior remains deterministic;
- normal existing singleton path remains unchanged.

---

## M4 — Accounting CSV lacks stable transaction/source identifiers

**Severity:** Medium  
**Primary files:**

```text
src/domains/reports/accounting-export.ts
src/app/desk/reports/export/route.ts
```

### Problem

The CSV exports:

```text
Date
Type
Customer
Company
Invoice #
Amount
Method / reason
Notes
```

but not the source record ID, invoice ID, provider transaction ID, payment intent/refund ID, or another stable ledger key.

Two legitimate transactions can therefore have identical visible fields. Re-importing an overlapping date range also gives downstream bookkeeping systems no deterministic Appliance Desk ID with which to deduplicate.

### Required remediation

Add stable identifiers appropriate to the row type, for example:

```text
Transaction ID          # local Payment/Refund/Deposit-refund identity
Invoice ID
Provider reference      # when available
Customer ID             # optional but useful for reconciliation
Recorded timestamp
Effective date
```

Keep human-readable invoice number and customer name as display fields, not the only identity.

### Required tests

- two same-date/same-amount payments remain distinguishable;
- repeated export of an unchanged period yields stable IDs;
- provider-backed and manual rows have traceable identities;
- CSV formula-neutralization remains intact for textual fields.

---

## M5 — Lead-source conversion reporting groups uncontrolled free text as separate marketing channels

**Severity:** Medium  
**Primary files:**

```text
src/domains/leads/index.ts
src/domains/leads/schema.ts
src/app/desk/reports/page.tsx
```

### Problem

`getLeadSourceBreakdown()` loads every Lead and groups directly on trimmed `howHeard` text.

Values such as:

```text
Google
google
Google Ads
google ads
Facebook
FB
Friend
Referral
```

become separate buckets even when they represent the same marketing channel. Manual leads usually become “Not given.”

The Reports page describes this as a quick way to see whether marketing is actually working, so inconsistent source vocabulary can materially distort conversion-rate comparisons.

The function also performs all grouping in application memory; at current scale that is acceptable, but there is no reason for this report to require every Lead row once the data grows.

### Required remediation

Introduce canonical lead-source attribution while preserving raw text if desired.

Recommended model:

```text
sourceCategory / sourceCode  # canonical reporting dimension
howHeardRaw                  # optional original visitor wording
campaign/source metadata     # where available
```

For existing data, provide an owner-controlled mapping/backfill rather than guessing ambiguous values.

Use SQL grouping once canonical categories exist.

### Required tests

- capitalization variants map to one configured category;
- unknown/custom source remains preserved;
- historical raw value is not lost;
- conversion counts equal underlying lead/customer transitions;
- large source report does not load every lead merely to group it.

---

# Verified strengths / non-findings

A useful audit should preserve the areas that are already stronger than the findings above.

## 1. Core BusinessSettings update + audit is atomic

`updateBusinessSettings()` reads the previous singleton state, upserts the new state, and creates the `settings.update` audit inside one Prisma transaction. A failed audit does not intentionally leave a half-recorded settings change.

## 2. Section-specific settings saves protect unrelated configuration

`SETTINGS_FIELDS` and `settingsSectionUpdate()` whitelist the exact fields each section may save. A stale Service Area browser form cannot overwrite Pricing/Policy values, and vice versa.

## 3. Money storage uses integer cents

The owner form accepts dollars for usability, while server-side settings actions convert into integer cents before persistence. The audit found no justification for a floating-point-money finding in this path.

## 4. Tax is deliberately not guessed

The settings UI visibly warns when `taxRateConfirmed` is false. The product’s documented rule remains that the owner must obtain the actual rate rather than the software inventing one.

## 5. `/desk/revenue` has careful financial labeling

The newer Revenue page correctly distinguishes:

- estimated MRR/ARR;
- gross invoice payments;
- invoice refunds shown separately;
- past-due recorded balances;
- failed-payment counts.

It explicitly says gross payments can contain deposit, fees and tax and are not net cash, rent, or profit. That terminology is substantially stronger than the older `/desk/reports` reconciliation and should become the standard vocabulary.

## 6. Revenue-record pagination uses a consistent database snapshot

`getRevenueRecords()` runs count/sum/page queries in a repeatable-read transaction, shares one predicate, uses deterministic timestamp + ID ordering, and returns totals across records beyond the visible page.

A real disposable-Postgres test verifies succeeded/manual payments, refunds, pending/failed exclusion and page totals.

## 7. Accounting export avoids double-counting the Deposit liability record as a second receipt

Deposit cash is already represented through the original succeeded Payment. `getAccountingTransactions()` correctly does **not** emit `Deposit.amountCents` as a second positive cash movement merely because a liability row exists.

## 8. Accounting export reads payments/refunds/deposit-refunds from one repeatable-read snapshot

Although the result is unbounded (H6), the snapshot choice itself is sound: the three source sets are not intentionally read from different database instants during one export.

## 9. Invoice/payment source records remain the correct long-term reporting foundation

The billing webhook preserves invoice line items, tax, paid amounts and succeeded Payment rows rather than trying to derive “cash happened” from agreement status. The remediation should use those source records more precisely, not replace them with agreement-state guesses.

---

# Cross-package overlap / deduplication

The following issues are **not** counted again in Package 5:

- Package 2 M1 already tracks concurrent price changes corrupting `PricingRule` history.
- Package 2 H7/H8 already track configured fee/policy defaults not flowing reliably into normal agreement creation/billing.
- Package 2 H3 already tracks concurrent late-fee application.
- Package 4 H5 already tracks lifetime utilization being inappropriate for current shortage/underutilization recommendations.
- Package 3 already tracks exception-inbox broad/unbounded query behavior generally; Package 5 M1 only adds the distinct **incorrect repair-cost completeness predicate** shared by Reports/Exceptions.
- Package 3/other audit work tracks staff/accountability issues; this report does not re-audit those role boundaries.

The implementation phase should deduplicate shared fixes across packages instead of landing multiple versions of the same infrastructure.

---

# Codebase-specific remediation plan

Package 5 should be remediated in a few substantial changes rather than one PR per finding.

## Remediation Package A — Financial basis & ledger truth

**Priority:** Immediate  
**Addresses:** H1, H2, H3, H4, H5, M4

### Goals

Establish one explicit financial-reporting vocabulary and make every report reconcile to durable source records.

### Work

#### A1. Define financial bases in code and docs

Use explicit terms such as:

```text
Expected recurring rent
Gross cash received
Gross invoice-applied payments
Refunds
Net cash
Deposits held/refunded
Tax collected
Fees collected
Credits applied/unapplied
```

Do not use generic `actual`/`revenue` names when categories differ.

#### A2. Replace agreement day-proration collection warning with invoice-ledger reconciliation

Build a query/service that can answer at least:

```text
rent charges issued/due
rent payments allocated/collected
rent refunds/credits
rent balance/gap
```

Keep one-time deposits and tax out of rent reconciliation.

If exact allocation between line kinds is not currently represented for partial invoice payments, define a deterministic allocation policy or report at invoice-total basis until such allocation exists. Do not imply per-kind accuracy that the ledger cannot prove.

#### A3. Normalize receipt/application modeling for manual money

Ensure a $100 manual receipt stays a $100 cash receipt even when only $80 is immediately allocated and $20 becomes customer credit.

Prefer a receipt + applications model so later use of the $20 credit does not create a second cash receipt.

#### A4. Add effective financial dates

Persist provider/manual effective dates separately from application `createdAt`.

#### A5. Make accounting export traceable and repeatable

Add stable IDs and explicit effective/recorded dates.

### Required acceptance tests

Build a reconciliation matrix covering:

```text
rent only
rent + tax
rent + deposit
rent + waiver
late fee
partial payment
manual check across several invoices
overpayment to credit
full refund
partial refund
deposit refund
credit later applied
provider webhook delayed across a day/month boundary
```

For every case, assert that source-ledger sums, Reports figures, Revenue figures and exported rows agree with their documented definitions.

---

## Remediation Package B — Reporting & dashboard scale

**Priority:** High before large-scale production use  
**Addresses:** H6, H7, M5 scale portion

### Goals

Make routine owner pages bounded and ensure all-history exports can scale without loading the full business history into one serverless function’s memory.

### Work

#### B1. SQL aggregation for agreement report

Aggregate financial totals at the database layer. Page agreement detail rows with stable ordering.

#### B2. Bound missing-cost repair list

Add total count + pagination, while preserving the corrected OR predicate from M1.

#### B3. Date-range/chunked accounting export

Make export range explicit. Stream/chunk or otherwise avoid a giant in-memory concatenated ledger.

#### B4. Lightweight Dashboard fleet metric

Create a dedicated scalar/query for the Dashboard rather than calling `getFleetAnalytics()`.

#### B5. Canonical lead source + database grouping

Once source categories exist, use a grouped query rather than loading all Lead rows.

### Required acceptance tests

Seed large representative data and establish explicit query/time/memory expectations. At minimum prove:

- Dashboard no longer reads every historical assignment/repair row;
- Reports returns a bounded page plus correct global aggregates;
- export covers a large requested range without omission/duplication;
- page boundaries remain deterministic under inserts;
- counts/sums match source rows.

---

## Remediation Package C — Configuration & report completeness

**Priority:** Medium/High  
**Addresses:** M1, M2, M3, M5 normalization

### Goals

Ensure configuration changes are auditable, missing configuration fails visibly, repair-cost completeness is truthful, and marketing-source reporting uses stable dimensions.

### Work

#### C1. Canonical incomplete repair-cost predicate

Share one helper/query fragment meaning:

```text
partsCostCents IS NULL OR laborCostCents IS NULL
```

Use it in Reports and Exceptions.

#### C2. Transactional catalog mutation + audit

Move photo/visibility/create/active-state change + audit into transactions.

#### C3. Production-safe missing settings behavior

Replace silent production placeholder fallback with a visible configuration-required state and health check.

#### C4. Canonical lead source model

Add normalized source category without deleting the original free-text evidence.

### Required acceptance tests

- one-sided missing repair cost is always flagged;
- catalog audit failure rolls back the configuration change;
- missing production settings cannot publish placeholder identity;
- source variants aggregate to the intended canonical category without losing raw input.

---

# Suggested PR consolidation for later remediation

To respect the owner’s CI-cost instruction, Package 5 should normally fit into approximately **three substantial remediation PRs**, ideally merged with overlapping package work where the same subsystem is already being changed:

1. **Financial ledger/reporting truth** — Package A.
2. **Reporting/dashboard scale** — Package B.
3. **Settings/report completeness** — Package C.

If Package 2’s Stripe/referral/ledger remediation creates the receipt/application or financial-ledger primitives first, Package 5 should consume that implementation rather than introducing a competing money model.

Full CI should run as a batch gate, not after every small report change.

---

# Definition of done for Package 5 remediation

Package 5 should be considered remediated only when all of the following are true:

- [ ] “Expected,” “gross,” “net,” “rent,” “cash,” “deposit,” “tax,” “fee,” and “credit” have explicit non-overlapping definitions in the reporting code/docs.
- [ ] Agreement reconciliation compares like-for-like financial categories.
- [ ] Refunds are represented wherever a report claims net/retained collections.
- [ ] A perfectly paid monthly agreement cannot become “behind” merely because a calendar month has 28/29/31 days.
- [ ] Manual overpayment cash is fully represented exactly once.
- [ ] Later application of an existing credit does not create another cash receipt.
- [ ] Financial exports use an explicit effective-date basis and retain recorded timestamps separately.
- [ ] CSV rows have stable transaction identities suitable for reconciliation/deduplication.
- [ ] Reports and exports are bounded/date-ranged/streamed or otherwise proven safe at realistic large volumes.
- [ ] Dashboard does not run full fleet profitability history merely to show a utilization scalar.
- [ ] One missing repair-cost component is visibly incomplete.
- [ ] Catalog settings mutations and their audit events are atomic.
- [ ] Missing production BusinessSettings cannot silently publish placeholder company information.
- [ ] Lead-source reporting uses stable reporting categories while preserving raw attribution.
- [ ] Existing precise `/desk/revenue` semantics and real Postgres revenue-record tests remain green.
- [ ] Existing CSV injection/formula-neutralization protections remain green.
- [ ] No Package 2/3/4 finding is duplicated under a second incompatible implementation.

---

# Audit conclusion

Package 5 does not need a new financial database. The codebase already has most of the durable source records required for trustworthy reporting: immutable invoice line items, succeeded Payment rows, Refund rows, Deposit liability/refund records, agreement price snapshots and explicit owner-recorded manual payments.

The main problem is **projection discipline**. The older Reports layer combines those records using definitions that are looser than the newer Revenue layer, and some operational/export paths still assume the entire business history can be loaded into one request.

The remediation strategy should therefore make the newer `/desk/revenue` philosophy the standard across the application:

> **Name every financial quantity by what it actually measures, reconcile only like-for-like categories, preserve the source ledger, and keep interactive/reporting queries bounded as history grows.**
