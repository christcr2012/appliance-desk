# Design — Batch K-CASH: cash envelopes, planned costs and bank reconciliation

Status: **OWNER-REQUESTED DESIGN — documentation-only PR; implementation after accepted review and prerequisites.**
Requested October 8, 2026: research low-cost startup banking/QBO, decide domain/UI/test contracts in advance for
Sol 5.6 light/medium execution, include robust simple planning for recurring/annual costs and original-plan comparisons/revenue-expense trends.
Baseline main `6f31f72013f0a1dcc1597160af32d329b27fa53e` (#321).
Depends on K-8; remains after launch. No launch reorder, account opening, paid plan, live transfer or provider activation.
Approved K stays authoritative except the specifically named amendments in section 9.
Research: [startup bank evidence](../research/2026-10-08-startup-banking-quickbooks.md).
Current code has receipts/credits/provider reconciliation/generic CSV, NOT K's journal/expenses or this budget.
Write JIT execution cards against actual merged K; do not treat planned models as existing code.

## 0. Product decision and boundaries

One business operating checking account initially; QBO Free is the first candidate, not a promised verified tenant.
Bluevine Standard first choice; Axos Basic direct-bank alternative. Bank choice is owner-confirmed setup, not code.
One set of customer invoices in Appliance Desk; QBO receives K journals. No customer invoice mirror, bank API,
Plaid/Yodlee fee, bank login storage, automatic payment, OAuth or new forecasting engine in this phase.

**Two questions, two views:** Budget asks what today's confirmed cash can fund. Plan ahead asks what future
costs need funding, and whether an explicitly estimated collection scenario might cover them.
A target/commitment is not cash, expense, invoice or permission to pay. Expected rents never fund an envelope.
Envelopes carry forward; calendar months are reporting views, not separate copies of money.
Reserve tax/deposit obligations from real evidence, not a percentage of every bank deposit.
Bank import observes money; K's underlying expense/receipt/other typed money records own accounting.
No generic editable journal entry UI; accountant corrections require a supported typed source or a reviewed amendment.

### Existing patterns to reuse and drift checks

Before a card, inspect only relevant contracts in:
- `prisma/schema.prisma`: Receipt, Payment, Deposit, CustomerCredit, TaxFilingPeriod/amendments/RDF; K additions once real.
- `src/domains/reports/accounting-export.ts`: current four-type generic CSV, receipt provenance; not a QBO journal.
- `src/domains/billing/ledger.ts`, `collected.ts`, `reconciliation-base.ts`: payment success/hold semantics, drift DTO.
- `src/domains/tax/filing-packet.ts`, `filing.ts`, `rdf-filing.ts`, filing-calendar: immutable obligations/payments/dates.
- `src/domains/reports/definitions.ts`: existing METRICS; extend it, never calculate finance in components.
- K accounts/poster/expenses/export once merged; shared active actor/transaction/private upload/audit patterns.
- Existing Money navigation and shared page/table/dialog/field primitives; Evergreen tokens, dark mode, 360/768/1440.
No parallel finance ledger replacing K. Adapt names mechanically in cards; document semantic conflict before affected work.

## 1. Roles, settings and simple starting experience

OWNER may configure accounts/envelopes/targets, import/match/reconcile, confirm accounting exports, allocate/undo funds,
record owner money/transfers, reopen verification with reason and manage holds.
ADMIN may view non-secret financial DTOs, review/import/match and post expenses under existing K permissions;
cannot allocate/undo envelopes, complete/reopen reconciliation, edit settings/mapping or record owner draws.
STAFF only existing own expense form plus optional allowed envelope label; no bank balance/reserve/forecast totals.
CUSTOMER sees no budget/bank data. Recheck active actor inside locked writes; never trust route protection alone.

Add owner-editable settings (BusinessSettings, or reuse K settings container):
`cashBudgetStartOn: DateTime?`, `cashBudgetEnabled: Boolean=false`,
`bankEvidenceMaxAgeDays: Int=7`, `budgetPlanningHorizonDays: Int=90`,
`budgetUpcomingWindowDays: Int=30`, `budgetReminderLeadDays: Int=7`.
Validation: age 1..90, horizon 30..365, upcoming 1..90, reminder 0..90; day keys in Denver.
Explain each setting in screen and offer restore default. Defaults are workflow controls, not tax/price assumptions.
No default tax percentage, loan rate, spending allowance or invented vendor price.
Seed editable discretionary envelope labels: Operating costs, Repairs and parts, Appliance purchases/replacement,
Annual fees and insurance, Income-tax planning, Owner pay, Emergency cushion. Values/targets initially absent.
Protected rows derive from liabilities, not editable labels with mutable required amounts.

Setup wizard: choose account display name/last four and K account -> import opening statement -> verify balances ->
review tax/deposit/card obligations -> add known costs -> allocate current surplus -> preview next 30 days.
Enable only after opening reconciliation and source completeness checks. Saving drafts never enables.
Example numbers appear only in clearly labelled isolated help/examples, never in live balances.

## 2. Additive schema contract

Every monetary field is integer cents (safe integer input; no JS floating-point dollar math). Stored datetimes UTC;
due/statement days are normalized via existing Denver date helpers. FKs below are real Prisma relations with
Restrict deletes, indexed FK columns, not free-text IDs except polymorphic source references with domain validation.
No cascade deleting journals, evidence, reconciliation or budget history. Private assets reuse existing storage scope.

| Model | Fields / identity / constraints |
|---|---|
| CashAccount | id cuid; ledgerAccountId unique FK LedgerAccount (ASSET, payment-source BANK role or owner bank asset); name; institutionLabel; lastFour optional exactly four digits; currency USD; active true; bankMatchWindowDays Int @default(7), CHECK 0..30 (owner-only per-account setting with optimistic version and explicit reset to 7); version 1; createdAt/updatedAt. No routing/full account number/credentials. Each separately numbered real account gets its own K account. |
| BankImport | id; cashAccountId FK; sha256; mapping Json schemaVersion 1; mappingHash; mappingRevision positive integer; rowCount; status ACTIVE/SUPERSEDED; supersedesImportId optional self FK; supersededAt/byUserId/reason optional; importedByUserId; createdAt; optional privateEvidenceId through existing document scope; unique(account,sha256,mappingRevision) plus partial unique(account,sha256) WHERE status=ACTIVE. Raw hash and all prior interpretations remain immutable evidence. |
| BankObservation | id; cashAccountId FK; importId FK; rowNumber; postedOn; signedCents (positive bank inflow); description capped 240 sanitized; externalId optional; fingerprint; occurrenceIndex; status UNMATCHED/MATCHED/IGNORED/SUPERSEDED; isActive Boolean default true, false for superseded mapping; ignoreReason optional; version; unique(importId,rowNumber); partial unique(account,externalId) WHERE externalId IS NOT NULL AND isActive=true. Superseded rows are preserved but excluded from matching, statement, cash and funding. No delete. Fingerprint alone NOT unique. |
| BankMatchGroup | id; cashAccountId FK; key unique; createdByUserId; createdAt; voidedAt/voidedByUserId/reason optional; version. |
| BankMatchItem | id; groupId FK; exactly one bankObservationId FK OR journalLineId FK; signedCents snapshot; partial unique active assignment for each referenced observation/line via active Boolean=true maintained with group. SQL XOR and active-assignment constraints. |
| BankReconciliation | id; account FK; fromOn/toOn; beginningCents; endingCents; status DRAFT/COMPLETED/REOPENED; revisionNo positive integer; isCurrent Boolean default true; priorCompletedId optional self FK; includedEvidence Json v1 containing immutable observation/line/group IDs/amounts/hash; completedAt/by optional; reopenReason optional; version; unique(account,fromOn,toOn,revisionNo) plus partial unique(account,fromOn,toOn) WHERE isCurrent=true. SQL from<=to. Completed evidence is immutable; a reopen creates a new row and never rewrites a prior completed snapshot. |
| CashHold | id; cashAccountId FK; amountCents positive; reason; effectiveOn; releasedAt/by/reason optional; version; createdByUserId/createdAt. Actual bank debit already observed is never also a hold. |
| BookCashEvent | id; commandKey unique; kind OWNER_CONTRIBUTION/OWNER_DRAW/BANK_TRANSFER/BANK_INTEREST/CARD_PAYMENT/CASH_DEPOSIT; amountCents positive; occurredOn; fromLedgerAccountId optional FK; toLedgerAccountId optional FK; sourceReceiptIds Json v1 for cash/check deposits; memo; status POSTED/VOID; version; createdByUserId/createdAt; reversalOfId optional unique self FK. Domain checks kind/account shape, bank cash source and USD; no arbitrary journal lines. |
| BudgetState | id singleton; revision 1; startOn optional; createdAt/updatedAt. Lock this row first for every allocation/consume/target mutation and reserve snapshot command. |
| BudgetEnvelope | id; name; groupLabel; sortOrder; active true; version; createdAt/updatedAt. Discretionary only. Hide/archive with nonzero balance requires move preview; no deletion. |
| BudgetMove | id; commandKey; envelopeId FK; signedCents nonzero; kind ASSIGN/RELEASE/SPEND/REVERSAL; sourceType; sourceId; eventKind; reason; actorId optional for source poster; createdAt; reversalOfId optional unique self FK; unique(commandKey,envelopeId,kind); partial unique(sourceType,sourceId,eventKind,envelopeId) for source-generated SPEND/REVERSAL only. Owner command envelope/kind legs are aggregated before write. Append-only; shared command audit stores payload hash for retry conflicts. |
| BudgetSpendSplit | id; journalLineId FK; envelopeId FK; amountCents positive; version; unique(line,envelope). Applied only to outflow bank lines; splits sum exactly that outflow. Corrections reverse prior BudgetMoves and replace atomically with a new source event version. |
| BudgetTarget | id; envelopeId unique FK; kind MONTHLY_SPEND/SAVE_BY_DATE/MAINTAIN_BALANCE; amountCents positive; dueOn optional; repeat NONE/ANNUAL; active true; cycleStartOn; version; createdAt/updatedAt. |
| BudgetCostPlan | id; envelopeId FK; name; amountCents positive; amountQuality EXACT/ESTIMATE; dueOn; recurrence NONE/MONTHLY/QUARTERLY/ANNUAL; anchorDay 1..31; anchorMonth optional 1..12; sourceType MANUAL/RECURRING_EXPENSE/PURCHASE_ORDER/TAX_FILING/TELECOM_PLAN; sourceId optional; active true; version; createdAt/updatedAt; unique sourceType/sourceId when nonnull. |
| BudgetCostOccurrence | id; planId FK; dueOn; amountCents snapshot; status PLANNED/PART_PAID/PAID/CANCELLED; sourceRevision; unique(planId,dueOn); version. |
| BudgetCostSettlement | id; occurrenceId FK; sourceType; sourceId; amountCents positive; reversalOfId optional unique self FK; createdAt; commandKey unique with payload hash; partial unique(occurrenceId,sourceType,sourceId) for originals where reversalOfId IS NULL. No duplicate settlement of the same source amount across occurrences: lock source and enforce aggregate <= source paid amount. |
| AccountingDelivery | id; exportBatchId unique FK K ExportBatch; status PREPARED/IMPORT_CONFIRMED/FAILED_BEFORE_IMPORT/RECONCILIATION_CONFIRMED; tenantLabel; edition FREE/SIMPLE_START/ESSENTIALS/PLUS/OTHER; confirmedAt/by optional; resolvedAt/byUserId/reason optional only for owner-attested FAILED_BEFORE_IMPORT; replacesDeliveryId optional self FK on replacement; period key; memo; privateEvidenceId optional; version. No automatic success from download. An uncertain/partial QBO import must stay unresolved, not marked failed. |

Add `JournalSourceType.CASH_EVENT` in K-CASH-1; add seeded INTEREST_INCOME and OWNER_DRAWS (equity) accounts and
internal TRANSFER_IN_TRANSIT (asset) only if actual cross-account posting requires it. Ordinary transfer is one
balanced event: debit destination bank, credit source bank; never income/expense. Card payment debits CARD liability,
credits bank. CASH_DEPOSIT debits bank, credits UNDEPOSITED; prove linked receipt totals and not already deposited.
Owner contribution debit bank/credit OWNER_CONTRIBUTIONS; draw debit OWNER_DRAWS/credit bank;
interest debit bank/credit INTEREST_INCOME. Reversals are exact inverses posted through K closed-period rules.
Statement date stays bank date even when journal correction must post in next open accounting month.

Add private BANK_STATEMENT/ACCOUNTING_CONFIRMATION document scopes through the existing upload model; if actual
storage has a different discriminator, extend it rather than a competing public upload.
All new models/enums/FKs/defaults/partial constraints enter backup, schema-health and populated restore tests.

### Review-resolved correctness contracts (2026-10-08)

**Correction of an incorrectly mapped CSV** is an owner-reviewed source correction, not a second bank statement. The
original raw `sha256`, preview, mapping and imported observations are kept forever. To reinterpret the same bytes
with a corrected date or debit/credit mapping, acquire the CashAccount lock, reject if completed statements depend
on the rows unless those statements are explicitly reopened, and void affected active matches under their own
audited conflict rules. In one serializable command, mark the prior BankImport SUPERSEDED, deactivate its observations
(and their active external-ID uniqueness claims), create the new ACTIVE revision with new mappingHash and rows, and
record actor, reason, affected IDs and both file interpretations in AuditLog. If verification or parsing fails, roll
back the *entire* supersede. Exactly one ACTIVE interpretation of a raw file per account, and never both in any
match, reconciliation or cash calculation. Do not delete old rows or reverse unrelated posted journal entries.
Repeat of a committed (account, raw SHA, mapping revision) command is idempotent; the same file and mapping
without a correction request returns the existing active import.

**Reopened statement versioning** preserves all original completion evidence. A completed row retains its
includedEvidence/hash, actor, ending amount and COMPLETED status forever. OWNER reopens with a reason by changing
only the previous row's isCurrent pointer to false, inserting revisionNo+1 with status REOPENED, isCurrent=true
and priorCompletedId referencing the former completion, in one locked transaction. Completing the replacement
freezes a new includedEvidence/hash snapshot. Financial continuity, account lock, adjacent statement periods and
completed-statement overlap checks use only current rows. History screens show the full priorCompletedId chain.
Later completed periods must be reopened in reverse order first and dependent verified-cash snapshots invalidated;
a stale simultaneous re-completion cannot replace another owner's chosen current revision.

**QBO failure before import** requires the owner to inspect the actual target tenant and attest that the file
created *zero* transactions, providing explicit reason, actor, timestamp and optional private evidence. Only then
can PREPARED transition to FAILED_BEFORE_IMPORT and permit a new overlapping replacement export with
replacesDeliveryId pointing to the failed delivery. A partly applied import, an unknown outcome or lack of
confirmation stays PREPARED/UNRESOLVED and blocks overlapping export; the owner must reconcile the target first.
IMPORT_CONFIRMED cannot be reclassified to failed merely to force re-export. Downloads, retries and provider
transport failures do not themselves prove unsuccessful QBO import.

**Per-bank match-window setting** is stored on CashAccount, not in client memory: OWNER may set integer 0..30,
default 7 and Reset to 7, all with actor/timestamp/version audit. ADMIN may inspect, not edit the setting.
Reject fractions, negatives and values above 30. SQL CHECK and service validation enforce the same range;
existing match groups retain their frozen dates/decisions after the setting changes.

## 3. Bank import, matching and statement proof

### 3.1 CSV contract and safety

V1 supports settled CSV only; no OCR, PDF parsing, live feed polling or bank API. PDF is private evidence.
Upload max 5 MiB / 10,000 rows, UTF-8/BOM, quoted fields/newlines parsed by a maintained CSV parser already installed
or add one reviewed dependency. Input maps Date, Description and either signed Amount or Debit/Credit;
optional stable transaction ID. Owner chooses MM/DD/YYYY or YYYY-MM-DD and credit/debit sign convention.
Preview first 20 + totals + rows rejected; invalid row blocks the whole commit, never silent skipping/truncation.
Reject ambiguous dates, multiple currencies, exponent values, unsafe cents, both debit+credit nonzero, invalid future
settled dates; decimal dollars at most 2 places -> integer parser. No remote URLs or spreadsheet execution.
Never log file contents. Raw full account numbers/SSN in descriptions are redacted before persistence.
Mappings are saved per account on explicit consent; export formula-injection protection remains K's shared CSV helper.

Exact same file is idempotent. Stable external ID dedupes across files. Without IDs, compute normalized
(date, signedCents, description) fingerprint and ordinal among identical rows; compare multiplicities against already
imported observations. Overlap with duplicates or changed descriptions goes to an explicit preview:
"These may already exist: keep existing / these are additional transactions." OWNER resolves ambiguous overlaps;
ADMIN can preview/import unambiguous sets only. No automatic fuzzy duplicate deletion. Store choices/multiplicity
in mapping evidence; identical legitimate same-day/same-amount purchases survive.
Transaction locks account, inserts import+rows+audit once; schema unique keys handle races.

### 3.2 Matching semantics

Book register = K journal bank lines; matches do not post accounting entries.
Suggest only same cash account, exact signed amount, bank date within 7 Denver days of source occurrence date.
7-day suggestion window is persisted per CashAccount as bankMatchWindowDays (integer 0..30, default 7, owner-only optimistic edit and AuditLog; Restore defaults to 7). Suggestions read the persisted value. Old match confirmations retain their frozen evidence. It is not automatic match authority.
OWNER/ADMIN confirms every group. One observation can match multiple lines, and multiple observations can match
multiple lines, only when signed sums exactly equal, all elements same account/direction, none assigned elsewhere.
Never net an unrelated debit against credit to disguise mismatch.
Lock account -> observations sorted ID -> journal lines sorted ID; unique active assignments; group+items+audit in one
transaction. Stale version/second claim returns deterministic conflict; no half match. Void draft match with reason;
completed-period group requires owner reopening first. Preserve original group evidence.

For unmatched outflow: "Find existing expense" first, then "Record missing expense" through K postExpense once.
For inflow: "Find payout/receipt" first; never automatically classify a Stripe payout as revenue.
Typed actions cover interest/contribution/draw/transfer/card payment/cash deposit. A genuinely new customer payment
uses existing receipt domain and allocations, not a second bank-income writer.
Tax debit matches actual recorded payment through T/K; missing actual payment is recorded in existing tax workflow.
Unsupported lending/principal/payroll/merchant adjustments stay unresolved with an explanation and require an
accepted posting amendment, not a guessed expense. Reconciliation cannot finish with such unresolved rows.

### 3.3 Reconciliation

Choose account, statement start/end, beginning/end balance and optional private PDF.
First statement needs owner-confirmed K opening book balance and any outstanding pre-start items; never import
a bank opening balance automatically again. Next statement begins the next day and beginning equals previous ending.
No overlapping completed periods or gaps; account lock serializes completion/reopen.

Equation: previous cleared ending (or validated opening) + signed bank observations in period = statement ending.
All observations must be matched or explicitly IGNORED with reason (duplicate/non-account row only, never unknown
expense). Sum signed matched journal bank lines must independently equal sum included observations.
Difference must be zero cents; refuse "plug"/balancing adjustment. Unmatched journal entries remain named outstanding
items; their date/amount explains ledger-vs-statement difference. Every earlier outstanding credit must be accounted
for before cash eligibility; it is never silently cleared by the ending balance.
Complete saves immutable snapshot/hash/counts/actor; reopening adds reason, invalidates later reconciliations and
dependent verified-cash labels, not K journal/export history. Re-complete in order; retain snapshots in audit/private
evidence. Completed reconciliation is proof for that date only, never a real-time bank connection.

## 4. Cash available, protected reserves and envelope accounting

### 4.1 Cash eligibility (conservative, deterministic)

For each on-budget cash account with a completed reconciliation at cutoff C:
cashNow = statement ending at C
+ cleared/matched later inflows
- ALL later journal bank outflows (cleared or not)
- pre-C journal outflows still outstanding at C
- unreleased holds.
Later matched outflows are subtracted once, not twice. Pre-C outstanding inflows add only if they subsequently match.
Cash eligible for the pool = sum cashNow across active on-budget accounts. Negative account values remain negative;
exclude Stripe balance, undeposited cash/checks, invoices, loans not received, personal accounts and promised income.
Between on-budget bank accounts, an unconfirmed transfer credit stays excluded while its debit reduces cash:
this temporary reduction is intentional; restore when credit clears. Do not add a transfer as new income.

Evidence age is measured from latest owner-confirmed full import-through day / completed statement.
A CSV row's max date alone is not completeness proof; import asks "Does this include all settled activity through X?"
Owner confirms with bank balance evidence. Compare adjusted book cash with observed balance, disclose difference.
Any stale account, unresolved observation, missing source/posting, negative readiness or owner-declared unknown card
obligation blocks new positive assignments and "fund plan" confirmation; release/reclassification/import/corrections
and actual expense recording still work. Display provisional numbers with reason, never green "safe to spend".

### 4.2 Protected obligations and shortages

Required amounts from K journal credit-minus-debit liabilities at same as-of after postPending:
customer deposits held; unapplied receipts and customer credits; sales tax per filing account; use tax; RDF payable;
business card outstanding liability if used. Clamp each individual required liability at zero, never offset one
customer/tax area's obligation with another negative balance.
Tax reserve uses full recognized unpaid liability (conservative even if invoice uncollected); never re-compute a
tax rate. Show "Some tax may relate to unpaid invoices; ask your CPA about filing basis" with source drill-down.
Filed is not necessarily paid: preserve tax reserve until actual bank outflow is recorded, subtract payments once.
If K currently reduces liability on filing without actual paid evidence, amend its source adapter before budgeting.
An amendment's additional unpaid tax raises required reserves once; disputed payment/refund reduces cash only when
actual source evidence says so. Pending customer refunds remain protected. Missing amounts make readiness UNKNOWN.

Waterfall: customer deposits/credits/unapplied -> tax (sales/use/RDF) -> card debt -> discretionary envelopes.
Within a protected group, stable source ID order; show required/funded/short per row.
Let P = sum required protected obligations; D = sum max(0, balance of each discretionary envelope).
Ready = eligibleCash - P - D; preserve negative ready as a visible shortage. Do not subtract planned costs twice:
money inside an envelope covers its commitments, not a second pool deduction.
Protected funded coverage uses max(0, eligibleCash-D); no auto-moving owner funds. If P grows or cash drops,
the screen shows allocations exceeding backing and proposes owner-reviewed releases from discretionary envelopes.
No assignment while Ready<0. While an envelope is negative, allow only reviewed coverage of that deficit;
block funding other envelopes until deficits are covered. Coverage uses the resulting backing equation below.
Protected obligations cannot be released as discretionary owner override. Legal reserve location, income tax amounts
and deposit interest handling remain CPA inputs; virtual coverage is not an escrow/trust claim.

### 4.3 Envelope movements

Balance = sum signed BudgetMoves since start, including carried-forward prior periods.
Assignment +X raises envelope; resulting Ready is recomputed using sum of positive balances. Clearing a negative
balance consumes no additional cash because its spending already reduced eligibleCash. Assignment above zero consumes
Ready; release of positive balance returns Ready. Never subtract the assignment total a second time.
Transfer is release+assign same command
and locked state revision. Sum assigned across months uses the SAME pool; future-month views never duplicate cash.
Command idempotency key + expected revision; lock BudgetState -> affected accounts/envelopes sorted ID; recalc latest
posted cash/obligations before write. Identical retry returns prior result; changed payload with same key conflicts.
No allocations beyond backing; releases cannot exceed positive envelope balance; money transfer never calls a bank.

Post expense/refund/tax/owner draw in source domain even if budget insufficient: never block recording reality.
For a discretionary bank outflow, consume split envelope(s) once; no split -> "Unassigned spending" attention and
readiness block, owner selects afterward. Negative envelope balance remains visible; no clamp hiding overspending.
Protected payments lower cash and corresponding liability; do not ALSO consume a discretionary envelope.
Supplier refund restores the original spending envelope only with exact source linkage; otherwise Ready/unresolved
classification until reviewed. Refunds to customers follow protected customer/tax semantics, not repairs envelope.
Owner draw is equity + Owner pay envelope consumption, not business operating expense.
No auto-consumption from both Expense and its later matched bank line; journalLine identity owns budget spending.
Corrections generate inverse BudgetMove; original history is immutable, source version unique.

V1 budget funding focuses on cash/debit spending. Business card obligations are protected in full from K liability
and explicit owner opening debt, not ignored; card purchases are listed as card commitments, NOT also bank spending.
A card payment reduces bank cash and card liability together and never consumes the purchase category again.
Full YNAB card purchase/payment-envelope mechanics are deferred; show this scope prominently when adding a card.
Without complete card evidence, budget readiness is UNKNOWN, never falsely safe.

## 5. Planning future costs and funding targets

Inspirations: YNAB/Actual document cash-only allocations, scheduled costs and savings for periodic bills.
We adopt those principles, not their branding or a second external budget subscription.
Sources and examples: [research addendum](../research/2026-10-08-startup-banking-quickbooks.md#budgeting-examples-and-design-evidence).

### 5.1 Known cost schedule

Plan a monthly subscription, quarterly premium, annual license/registered-agent fee, appliance replacement or a
one-time purchase. Cost occurrence is EXACT or ESTIMATE, never masquerades as paid or posted.
Generate occurrences in Denver for visible horizon only, paged/resumable and unique(plan,dueOn); month-end clamp:
31st -> last day of short month, following month returns to 31st; annual February 29 -> February 28 in non-leap years.
No automatic legal due-date changes; T legal due dates remain canonical.
Edits affect future unpaid occurrences; preserve paid/part-paid history. Cancel leaves evidence/reason; no fake payment.
Recurring K expense templates feed a linked plan automatically when owner chooses envelope; their drafts remain
draft expenses. No duplicate manual cost for linked source. Confirmed posted expense settles occurrence via explicit
source link, partial payments aggregate up to its amount; overpayment requires owner change of planned amount or
separate occurrence. Reversal reopens unpaid portion exactly once.

Tax periods appear read-only as protected planned payment using existing packet/due date. Never also create a
discretionary tax goal. Purchase orders contribute one editable ESTIMATE commitment until a posted linked expense
settles it; receiving parts/appliances is not proof of payment. COM cost plans link only when COM evidence exists;
provider estimates, statement expenses and payments are distinct and deduped through existing COM-N/K contract.
Manual bank/provider fees can be planned now; no default prices read from marketing promises.
Customer deposit refunds derive from actual approved refund decisions, not a blanket expense forecast.
Payment buttons say "Record payment in [source]" or "Open bank"; app never initiates it.

### 5.2 Target math

Each envelope has at most one active target; many cost plans can use that envelope.
- MONTHLY_SPEND: desired month capacity T; needed = max(0,T - net current-month spending - positive balance).
This preserves available leftovers without counting the same spent dollars twice. At month rollover net monthly
spending resets, envelope money remains.
- SAVE_BY_DATE: remaining = max(0,T-positive balance); monthly suggestion = ceil(remaining / remaining Denver months
including current and due month). Past/current due date asks full remaining now. ANNUAL resets after due month;
next cycle starts first day of following month, keeps leftover balance, no historical rewrite.
- MAINTAIN_BALANCE: needed = max(0,T-positive balance), no spending allowance implied.

For upcoming bills: current required capacity = sum unpaid occurrence amounts due within owner upcoming window.
Envelope fund-now need = max(target need, max(0, upcoming unpaid - positive balance)).
Do NOT add target + schedule blindly (insurance target and insurance bill would double count).
When a cost is intentionally separate, use a separate envelope; on-screen help shows this.
Annual $1,200 bill due six included months away with $0 saved suggests $200/month.
Exact cents example: $1,000 remaining over 3 months -> $333.34 first suggestion; recompute next month so final
balance reaches target without over-allocation; use existing ceiling integer helpers.
Monthly $100 target, $20 carried over + $10 assigned, $30 spent leaving $0 -> $70 additional, not $100.
Changing estimate updates future need only, never cash/expense.

### 5.3 Fund plan preview

Only OWNER confirms. Priority: cover negative discretionary spending; protected shortage explanation (release
proposal, not automatic transfer); earliest due unpaid bills; date targets; monthly targets; maintain-balance goals.
Within equal dates use owner priority/sortOrder then ID. Allocate at most Ready, cents exact; no percentage of expected
income. Preview each destination before/after and remaining shortage; complete under revision lock in one command.
Recurring reminders suggest funding, never auto-assign or auto-pay.
Move-money preview shows any bill/goal newly underfunded; cannot draw from protected obligations.

### 5.4 Forecast

Extend K-8 cashForecast DTO and METRICS, not a separate report engine.
Show two tracks: **No new collections** (confirmed cash vs planned unpaid costs) and **Expected collections — estimate**
(existing active rental schedule with source/as-of; overdue invoices separate, not assumed collected).
Never count pending payout as both forecast rental receipt and forecast bank deposit. Use each cash-flow source once;
known net payout can be a separate scheduled cash inflow, excluding underlying gross receivable already represented.
Taxes/fees included according to frozen evidence; unknown fees/collection timing labelled unavailable, not zero.
Budget target savings are allocations, not forecast cash outflows; actual planned bills are outflows once.
Source-linked recurring expense + occurrence + posted expense is one cost: once posted, remove paid plan amount
from forecast and show actual. Show first shortfall date/amount, with incomplete-data warning if any required source
missing. Forecast does not increase Ready or override assignment gate; no invented collection probability defaults.

## 6. UI and integration contract

Use Desk -> Money -> **Budget** with tabs **My money / Plan ahead / Review / Bank checks / Setup**.
Books and Sales tax remain their existing workspaces. No new customer screen or competing P&L.

My money: top confirmed/provisional cash + last bank check; protected summary with shortfalls; Ready to assign;
envelope rows show Saved now / Upcoming bills / Needed / Remaining. Mobile cards, expandable transaction history,
"Set aside", "Move money", "Fund upcoming costs" preview. No drag-only controls or colors-only readiness.
Annual costs grouped in ordinary words; explain that virtual envelope does not move money at bank.
Plan ahead: 30/90-day list/calendar toggle using existing calendar style, unpaid/partial/paid filters, EXACT/ESTIMATE
labels, source link, add known bill wizard (amount, next due date, repeats, envelope), target selector with computed
monthly suggestion. Coverage panel separates no-new-income from estimated collection track; expected money never
mixed into top balance. What changed since last plan is a small audit list, not another notification stream.
Bank checks: import map/preview, unmatched queue, proposed exact matches and "record missing item" actions;
statement wizard -> differences/outstanding list -> complete. Separate account tabs, never consolidate statements.
Setup: bank display identity, selected accounting edition, owner setup checklist/status UNKNOWN/VERIFIED/FAILED,
saved mapping, evidence freshness controls, optional target goals, K account mapping link, private proof.

Context integration through shared `BudgetContextCard`:
- K expense editor: envelope/split picker; "After this expense: $X remaining" is a preview, never authority to post.
Staff receive only allowed envelope labels and own submission fields.
- Purchasing: source-linked cost plan + cost quality + "Saved/short" and Budget link; no blocking stock receipt.
- Inventory/appliance payback: link to Replacement envelope; no auto purchase/retire decision.
- Sales tax return: actual unpaid reserve/coverage and Budget link; T filing controls stay authoritative.
- COM cost screen (after COM): existing actual/estimated costs + assigned envelope + source-linked plan; no new billing.
- Today: unresolved bank rows, stale checks, protected shortfalls, overspent envelopes, due unpaid costs/annual target
shortage. Reuse exception infrastructure, dedupe source key, role DTOs and recovery route; no private bank descriptions.
- Reports/K forecast: existing metric registry source/as-of/incomplete labels; no second P&L or receipt total.

Error examples: "This money has not reached your bank yet"; "Bank activity is missing through October 8";
"$120 is still needed for taxes"; "This transaction is already linked"; "Your plan changed; review the new amounts".
No unauthorized raw imported row, private receipt/statement, customer data or totals in search/audit error payloads.
Keyboard focus in preview/confirm/return, accessible labels, currency readouts, visible text states, 200% zoom,
reduced motion; phone dark/light/axe inventory coverage per repo conventions.


### 6.1 Reports, comparisons and month-end review

Extend the existing Reports hub and K report services; Budget gains **Review** tab linking the same views.
One shared domain calculation and metric definition per measure. No duplicated report SQL in pages.
Implementation lives in `src/domains/budget/reports.ts` for budget comparisons and extends the actual K finance
report module for accounting series; register public DTOs in the existing metric registry.
Report screens use the existing date/filter/export/table/chart primitives, not a dashboard builder.

| Report | Default / measures / action |
|---|---|
| Business trends | Last 12 calendar months; K recognized revenue, operating expenses, depreciation and net profit, monthly bars + profit line + accessible table; category drilldown, current vs prior period, incomplete-month warning |
| Planned vs actual | Selected month, original published plan by default; planned spending, actual net spending, variance and remaining unpaid commitments per envelope/category; separate revised-plan selector and explanation |
| Cash movement | Month inflows/outflows/opening/closing for selected bank accounts; operating collections/spending separated from tax, customer deposits/refunds, capital, owner money and transfers; gross-to-net Stripe bridge |
| Spending detail | Operating expense category/vendor over months, category totals/share and recurring vs one-off costs only where source classification exists; unclassified row remains visible |
| Upcoming coverage | Next 30/90 days, due costs, saved now, protected shortfall, target needed and first no-new-collections shortfall date; links to Plan ahead and funding preview |
| Reserves and bank health | Required vs backed tax/deposits/card debt, unassigned cash, holds, unmatched rows, outstanding items, evidence freshness and accounting-delivery status |
| Existing K/operational reports | Reuse K P&L, balance sheet, appliance payback/profitability, year-end packet and cash forecast; link existing collection/aging, utilization and cost metrics only when their registry definitions exist |

**Profit trends contract:** Recognized revenue = credits minus debits in K REVENUE accounts.
Operating expense/depreciation = debits minus credits in the corresponding K EXPENSE accounts, shown separately;
net profit = revenue minus all expenses. Contra/refund/reversal entries keep their signed effect.
Use K accounting-period rules and finalized journal facts, not invoice face values or bank deposits.
Acquisitions/capitalization, contributions/draws, principal/card payments, customer deposits and sales tax are not
operating revenue/expense; show them in cash movement where applicable. Interest uses its K income classification.
Closed period numbers retain original ledger truth; later-period corrections follow K and never secretly backdate.
Every report says **Accounting basis: K ledger** and shows the K policy's actual basis once implemented; never label
it cash-basis or tax-ready by assumption. A separate **Cash movement** tab explicitly uses bank journal movements.
Debit and credit between selected business bank accounts cancel in consolidated movement but remain visible in
per-account detail. Stripe clearing movements are not customer revenue a second time.
Expense detail reconciles to report totals; category changes follow effective journal account/snapshot evidence,
not renamed live labels that reclassify old facts. Vendor unknown is a visible group, not dropped spend.
No customer-by-customer profitability promise until allocation evidence exists; K payback shows incomplete costs.

**Published monthly plans:** Drafts are editable, publishing is OWNER-only and immutable.
Add `BudgetPlanVersion`: id; monthKey YYYY-MM in Denver; version Int; publishedAt/by; sourceRevision;
budgetRevision; schemaVersion=1; payload Json; sha256; note; supersedesId optional self FK;
unique(monthKey,version), Restrict deletes. Payload validated server-side contains envelope ID/name snapshots,
planned spending cents, planned funding cents, opening saved cents, scheduled occurrence IDs/amounts/quality,
and optional forecast revenue cents with scenario label. Forecast revenue is informational and never cash authority.
Each monetary input is a safe integer, planned spending/funding nonnegative; no arbitrary formulas or account IDs.
No FK to mutable plan rows required for historical amounts; optional source references are validated at publication.
Seed draft planned spending from occurrences due in month; target savings seeds **planned funding**, never spending.
Owner explicitly reviews amount for categories without schedules. No automatic snapshot from current actuals.
Publish rechecks active actor and locks BudgetState -> K posting revision; stale preview returns conflict.
Use per-month monotonic version and commandKey idempotency in publish command (persist unique commandKey).
No previous-month published plan? Start blank draft; copying last month is explicit preview with due dates recalculated.
Allow publish after month begins with clear **Published on [date] after period start** badge.
First published version is the original baseline; additional versions require reason and stay selectable.
Changing target, schedule, envelope name or expense split cannot mutate published payload.
Year/quarter comparison takes original version per month by default, never sums multiple versions of one month.
Missing published month is **Unplanned**, not zero. UI offers Publish plan, Compare versions and Explain changes.

**Variance rules:** Spending variance = actual net cash spending minus planned spending
(positive = over plan). Funding variance = actual assignments minus releases minus planned funding
(positive = more set aside). Show these as separate columns; allocating money is not spending.
Actual spending = signed SPEND/REVERSAL movements in the reporting month, source-book occurred date per K;
refunds/reversals negative. Show capital/owner/tax/deposit uses in separate sections with accounting labels.
Unallocated/unclassified bank outflows have their own row; report cannot imply all costs have been assigned.
Envelope start balance + assignments - releases - net spending = ending balance; carryover appears separately.
Remaining commitments = unpaid occurrence amount, not planned minus actual, which can include unrelated purchases.
Percent variance only for positive nonzero plan; zero/missing denominator gives em dash with reason.
Optional forecast revenue comparison = actual K revenue minus explicitly planned forecast revenue, independently
labelled **Estimate**; absent estimate is unavailable. It never changes ready-to-assign or banking proof.
No inferred profit plan from envelope funding. An expense paid on card is K expense when posted, cash outflow when
bank pays card; show bridge and disclose limited V1 card category attribution rather than treating payment as a new expense.

**Time/filter contract:** Calendar month/quarter/year/YTD/custom day range in Denver; defaults this month for budget,
last 12 months for business trends. Presets previous period and same period last year. For an unfinished month,
default comparison is month-to-date vs same elapsed day of prior month (clamp last day); full month option labelled.
Annual/quarter partial comparison uses same elapsed calendar range. Missing history means unavailable, not zero.
Month series is paginated/bounded to 60 buckets; daily custom ranges max 366 days.
Revenue/expenses support accounting category filter; budget supports envelope; cash supports account.
Do not apply an envelope filter to ledger profit measures that cannot be allocated authoritatively.
Source/as-of/watermark, selected basis, plan version/published date, completeness reasons and permissions appear
beside totals and in exports. Profit margin = profit/revenue only for revenue >0.
Change % uses positive prior denominator only; negative/zero prior gets amount change without a misleading percent.
Values use integer cents; display rounding never changes aggregation. No invented projections before sufficient data.

Every total opens a deterministic paginated source list with stable date/id sorting, reversal/source link,
amount and classification; sum over all source rows must equal displayed total independent of page size.
Export current filtered report CSV, with metadata columns, safe formula escaping and role checks; it is labelled
**Report export**, not the QBO journal import. Reuse existing export infrastructure; avoid PDF/template engines.
Charts have equivalent tables, keyboard access, text explanations and no color-only meaning.
OWNER/ADMIN access per section 1; STAFF/customer cannot access business totals or export them.
Saved filter presets use O-7's typed preferences when available; no new persistence or arbitrary query editor here.
A fixed owner summary shows revenue/expenses/profit, cash available after protection, planned-vs-actual spending,
due costs and unresolved banking tasks. Do not allow hiding mandatory readiness exceptions.

**Month-end review:** Reuse existing tasks/readiness UI: bank statement complete; unclassified items resolved;
expenses recorded; reserves checked; plan published/reviewed; QBO import confirmed; K close when appropriate.
Each step links to authoritative action, shows done/needs attention/unavailable from facts, never a freehand
checkbox asserting reconciliation. Plan publication is not accounting-period close. Saving a report does not file taxes.
Completed review produces a private immutable report snapshot with selected plan version, source watermark,
filters, calculated totals, readiness evidence and generatedAt. Reuse K's period snapshot artifact model if present;
otherwise add `BudgetReviewSnapshot` (id, monthKey, createdAt/by, schemaVersion, payload Json, sha256).
Re-running creates new artifact; late facts flag earlier snapshots outdated but preserve them.
No stored calculated report totals as an editable competing ledger.

## 7. Functions and transaction order

New `src/domains/books/cash/`: accounts.ts, import.ts, matches.ts, reconcile.ts, events.ts, cash-readiness.ts.
New `src/domains/budget/`: envelopes.ts, moves.ts, protected.ts, targets.ts, plans.ts, context.ts.
Reuse K poster/reports and typed DTOs. Public signatures (ordinary imports/types resolved by card):
- previewBankImport(accountId,file,mapping,actor) -> signed preview token/hash,row summaries,problems,overlap decisions.
- commitBankImport(file,mapping,previewToken,choices,commandKey,expectedVersion,actor) -> importId. Token is signed with existing server signing mechanism, binds actor/account/file+mapping SHA/version, expires in 30 minutes; reparse file/recheck overlap and reject changed/expired preview. No trusted client row array.
- confirmBankMatch(accountId,observationIds,journalLineIds,commandKey,versions,actor) -> groupId.
- completeBankReconciliation(id,expectedVersion,actor) -> immutable snapshot; reopen(id,reason,actor).
- recordBookCashEvent(input,commandKey,actor) -> eventId; voidCashEvent(id,reason,expectedVersion,actor).
- getBudgetSnapshot(asOf,actor) -> cash/obligation/envelope/ready/provenance/problems DTO.
- previewBudgetFunding(envelopeIds?,asOf,actor) -> proposed moves + stateRevision + sourceSnapshotHash.
- applyBudgetMoves(moves,commandKey,expectedRevision,sourceSnapshotHash,actor) -> newRevision.
- postBudgetSpendingFromJournal(cursor,limit) -> counts/nextCursor; recoverable/paged/idempotent.
- publishBudgetPlan(monthKey,payload,commandKey,expectedRevision,sourceRevision,actor) -> immutable version.
- getBudgetReport(filters,actor), getBusinessTrendReport(filters,actor) -> totals/buckets/provenance DTO.
- createBudgetReviewSnapshot(monthKey,planVersionId,expectedWatermark,actor) -> private immutable artifact.
- getPlanAhead(from,to,actor), upsertTarget/input and upsertCostPlan/input with version.
- settleCostOccurrence(occurrenceId,source,amount,commandKey,version,actor) -> status; reversal inverse.

Snapshot reads use consistent transaction; any allocation first brings K journal and budget spending current outside
allocation transaction, then locks BudgetState and rechecks source watermark/hash inside. If source poster committed
new lines/obligations, return conflict/retry instead of using stale preflight. Source watermark must be monotonic K
posting revision; add singleton revision incremented in EVERY K journal writer under shared lock (section 9).
Lock order for transactions spanning budget/books: BudgetState -> book posting revision -> cash accounts sorted ->
envelopes sorted -> source rows sorted -> dependent rows. All affected writers follow it; document drift before coding.
No provider/network calls inside DB locks; no K read helper with side-effect poster nested in allocation transaction.
Preview cannot reserve money or mark imports/periods paid. Every compound command+audit either commits wholly or not.
Undo is a reviewed inverse action with latest backing checks, never deletion; cannot undo reconciled source directly.

## 8. Implementation units and proofs

JIT cards, written by selected model against approved merged prerequisite. Light for mechanical UI/help/fixtures;
medium for money, schema, matching/locks/import/recovery; no compulsory model change.
Register units in work-index. Bound production changes under AGENTS; combine adjacent compatible units only within
budget. Additional split must preserve named scope/IDs, no fake placeholders. One migration per schema unit.

| Unit | Prerequisite | Scope / named proof |
|---|---|---|
| K-CASH-1 | K-8 | Bank account/import/match/reconcile + BookCashEvent schema, K source revision, accounts/private scopes; tests/cash-schema-integration.test.ts populated upgrade/restore and SQL checks |
| K-CASH-2 | K-CASH-1 | CSV preview/dedupe/typed cash events/posting rules; tests/bank-import.test.ts, bank-import-integration.test.ts, books-cash-events-integration.test.ts |
| K-CASH-3 | K-CASH-2 | Matching/reconciliation/cash readiness + bank screens; tests/bank-reconciliation-integration.test.ts; e2e/bank-checks.spec.ts |
| K-CASH-4A | K-CASH-3 | Budget/target/plan/settlement schema and restore; tests/budget-schema-integration.test.ts |
| K-CASH-4B | K-CASH-4A | Protected reserves/assign/spend/reversal/locking; tests/budget-money-integration.test.ts |
| K-CASH-5A | K-CASH-4B | Cost schedules/targets/settlements + K forecast dedupe; tests/budget-planning.test.ts, budget-planning-integration.test.ts |
| K-CASH-5B | K-CASH-5A | My money/Plan ahead/context cards/Today/metrics; e2e/budget.spec.ts, tests/budget-context-access.test.ts |
| K-CASH-6 | K-CASH-5B | QBO detail default/delivery proof/wizard/owner guide; tests/books-export-delivery-integration.test.ts; e2e/books-export.spec.ts |
| K-CASH-7 | K-CASH-6 | Published monthly plans/review snapshots, budget variance and K trend reports; tests/budget-reports-integration.test.ts, tests/business-trends.test.ts, e2e/money-reports.spec.ts; migration batch_k_cash_report_snapshots |

Mandatory cases (each named card maps them to individual assertions):
- $108 gross payment/$8 tax/$3 fee/$105 payout: rent $100, tax $8, fee $3, clearing ties; bank payout once.
Tax still required before payout arrives; no spendable Stripe pending balance.
- Exact import retry, overlapping files, two indistinguishable legitimate purchases, swapped debit signs, quoted
newlines/BOM, too-large file, malformed decimals/formula payload/redaction, rollback; no partial rows.
- Same-amount different account/date, many-to-many exact group, mixed-sign rejection, two simultaneous matches,
group rollback, statement gap/overlap, last-day Denver DST, reopened earlier statement invalidates later proof.
- Missing bank expense -> existing expense first/new post once, bank fee, interest, owner capital/draw, internal
transfer in flight, cash/check deposit from receipts, card payment; every typed journal balances and reverses once.
- Same source posted twice/concurrently -> one spend; source/obligation change races assignment -> conflict;
two assignments cannot overfund, source revision is checked, holds/negative account/stale/unknown evidence block;
expense reality is still recorded; release/undo never borrows protected reserve.
- Tax cash vs accrual obligation disclosure; filed-but-unpaid, amendment/RDF liability, customer deposit/refund/
credits, tax refund and pending customer refund; totals reconcile without counting tax reserve twice.
- Annual goal cents, monthly carryover/spend example, leap-day/31st/quarterly recurrence, duplicate linked manual plan,
partial/overpayment/reversal settlement, edited recurring cost not rewriting paid history, no target/schedule double.
- Forecast unpaid invoice/pending ACH excluded from cash, receipt/payout and expense/occurrence dedupe, unknown fees
unavailable; target saving not an outflow; no-new-income track exposes shortfall independently of estimate.
- OWNER vs ADMIN completion/assignment/configuration, revoked actor inside tx, STAFF own submissions and no totals,
CUSTOMER denial, private file ID guessing/recovery, bounded pagination at >10,000 records.
- QBO Free setup never claims verified from research/download; sample DETAIL CSV import/matching/statement proof,
duplicate import warning and uncertain import quarantine; downloaded bank row never auto-added as revenue.
- Reports: immutable original/revised monthly plans, missing plan vs zero, schedule/target edits preserving history,
carryover and partial settlements, spending vs funding variance, zero/negative denominator, prior MTD/leap-day,
missing history, capital/deposit/tax/draw exclusion from P&L, card expense/payment bridge, refunds and reversals,
internal transfer cancellation, source drilldown/export totals at multiple page sizes, unclassified/incomplete rows,
revoked actor and duplicate publication race, private snapshot restore and stale snapshot warning.
- Phone/keyboard/light/dark/axe; new route inventory + shard assignment; restore private evidence without reviving
deleted material, backup/schema health, old populated defaults OFF, exact-head CI and preview.

## 9. Specific amendments to K (win only for these topics)

1. K-5 QBO default becomes DETAIL when a bank account is being reconciled; DAILY_SUMMARY remains explicit advanced
option with bank-matching warning. A summary bank line combines real transactions and may be hard to match.
Do not silently change Xero/generic defaults or export old batches differently.
2. K export provenance gains explicit prepared vs owner-confirmed imported status via AccountingDelivery.
Already IMPORT_CONFIRMED source journal entries cannot be exported in another target-QBO batch by default;
re-download same immutable file with "Already imported" warning. PREPARED or uncertain batches require owner resolve
"imported / failed before import" before generating an overlapping batch. CSV import cannot guarantee remote
idempotency; never claim stable journal numbers alone prevent duplicates.
3. Typed BookCashEvent supplies missing owner draw/interest/transfers/card-payments/cash-deposit sources, never
arbitrary manual journal entries. Amend K system account list/poster/source enum and finance readers exhaustively.
4. Add monotonic shared posting revision for atomic cash allocation snapshots, increased by every journal
writer (poster, opening, expense/tax/cash-event reversals). All such writes acquire shared order above.
5. K opening balance is owner/bookkeeper-confirmed composition, not blindly crediting existing Stripe money to
OWNER_CONTRIBUTIONS. Existing cash may be unpaid deposits/credits/tax or prior equity. Setup captures asset and
liability opening components; sum debits=credits, equity only confirmed residual; no duplicate pre-start receipts.
If K shipped older rule, additive reviewed opening correction before budget activation; never rewrite closed rows.
6. Reconcile RDF and tax filed-vs-paid against final T evidence. File submission is not bank settlement.
Record confirmed paid evidence with actual amounts/dates, keep unpaid liability and future protected requirement.
Do not count tax payment from both TaxFilingPeriod and BankObservation.
7. K-8 forecast gains section 5.4 sources; no second engine. Existing unsupported loan/payroll posting remains a
reviewed amendment requirement, not quietly invented by import.

Direct QBO sync remains deferred (K section 9): only after file exports used for a quarter, owner selected paid/API
capable plan and accepted separate provider design. Budgeting works without OAuth; no developer pricing assumption
from old K text is used for current budgeting or automatic spend.

## 10. Acceptance and owner gates

Design/request does not authorize bank application, identity-document upload, purchases, payments/transfers,
live Stripe change or accountant filing. Owner inputs IN-54 (bank/QBO setup verification), IN-55 (opening composition,
reserve/legal treatment, actual goals/debts) only gate activation/account-specific facts, not synthetic engineering.
No fixed legal percentages, fees, APYs or income-tax amounts. No automatic account/credit application.

Done: every named proof green; K journal and bank statement independently tie; budget has protected obligations,
targets/plans and cash-only assignment; immutable plan comparisons and revenue/expense/cash trends tie to sources; contextual screens reuse source domains; forecast labels true unknowns;
owner guide contains tested import/match/statement/correction weekly/monthly instructions.
Runtime remains unchecked until implemented. Later paid sync/full credit-card budget/automatic bank transfer are
explicit deferred work, never unfinished stubs. This design is reviewable product scope, not a delivered bank feed.
