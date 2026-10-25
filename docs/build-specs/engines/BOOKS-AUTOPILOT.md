# Build spec — Books on autopilot (BA-1, BA-2, BA-3)

Design: `docs/designs/BOOKS-AUTOPILOT.md` sections 3, 5, 6, 7, 10 (read it). This spec turns those sections into exact
steps against the code as of 2026-10-25. Screens for Books home and Equipment value (design BA-4, BA-5) are in
`screens/BOOKS-TAXES.md` (AR-7). Approved by Chris 2026-10-25. Money rule: **book entries are never edited or
deleted; corrections are new entries; locked months stay locked** (existing K rules).

## 0. Gaps found in the code (all fixed by BA-1)

1. Nothing records itself: the nightly job returns `PAUSED` unless `BOOKS_STRIPE_SYNC_ENABLED=true`, and `postPending`
   runs only from a button or an export (`src/app/api/cron/books-nightly/route.ts`).
2. Appliances must be enrolled by hand (`enrollBookAsset`) and depreciated per appliance, 12 months per press
   (`postBookDepreciation`).
3. Retiring an appliance in Equipment (`retireAppliance`, `src/domains/inventory/guided-actions.ts`) does not touch the
   books; staging book retirement is a separate Books form (`retireBookAsset`), and a shop sale of a retired appliance
   is refused until someone does it ("Stage this appliance's book retirement first", `disposeRetiredBookAssetInTx`).
4. **Finishing a retired plan without a sale** (scrapped, thrown away, donated — `completeRetiredPlan`,
   `src/domains/inventory/retired-plans.ts`) never removes the appliance's remaining book value, so the books keep
   showing equipment the business no longer has (PLAN.md flagged this as "not confirmed in code"; it is not done).
5. Every books write requires a person (`assertActiveTeamActor(tx, userId, ["OWNER"])`), so an automatic job cannot call
   them, and `BookAsset.createdByUserId` is required.

## 1. BA-1 — the engine runs itself

### 1.1 Data (additive migration `20261026050000_books_autopilot`)
- `BookAsset.createdByUserId String?` (drop NOT NULL — additive; `scripts/check-migrations.mjs` allows it) and
  `enrollmentSource String @default("MANUAL")` (`"MANUAL" | "AUTOMATIC"`).
- `BusinessSettings.booksLastBroughtUpToDateAt DateTime?`, `booksLastProblemCount Int @default(0)`,
  `booksConsecutiveFailedNights Int @default(0)`.

### 1.2 One actor type for books writes
In `src/domains/books/actor.ts`: `export type BooksWriter = { kind: "person"; userId: string } | { kind: "automatic" }`
and `async function assertBooksWriter(tx, w, roles = ["OWNER"])` — a person goes through `assertActiveTeamActor`; the
automatic writer is accepted **only** when called from code paths listed in this spec (it is not reachable from any
server action: a test greps `src/app` and fails if `{ kind: "automatic" }` appears there). Audit rows for automatic
work use `userId: null` and `newValue.by = "automatic"` (the pattern `auto-renew.ts` already uses).

Refactor, without changing behavior for people:
- `enrollBookAsset(userId, …)` → body moves to `enrollBookAssetInTx(tx, w, applianceId, placedDateKey, source)`; the
  public function opens the same Serializable transaction and calls it with `{ kind: "person", userId }`, `MANUAL`.
- `postBookDepreciation(userId, id, through)` → `postBookDepreciationInTx(tx, w, id, through, { maxMonths })` (people
  keep the 12-month cap; automatic passes `maxMonths: 360`).
- `retireBookAsset(userId, …)` → `retireBookAssetInTx(tx, w, id, expectedVersion | null, intent, retiredDateKey)`
  (`null` version = "the current one", automatic only).
- Existing unit fakes get the new `tx` calls in the same commit (AGENTS section 4).

### 1.3 The nightly job
`src/app/api/cron/books-nightly/route.ts` becomes two `runAutomation` rules in sequence (same 3:40 am schedule, same
`maxDuration` 60 — if the always-half needs more, it processes in pages and the next night continues):
1. **`books-nightly:record` — always, once `booksStartDate` is set** (no env switch). `runBooksAutopilot(now)` in
   `src/domains/books/autopilot.ts`:
   a. `postPending({ limit: 500 })` (existing; idempotent by `sourceType/sourceId/eventKind`).
   b. **Auto-enroll**: appliances where `acquisitionCostCents > 0`, status not RETIRED, no `BookAsset`, and the
      capital source exists (`verifyCapitalSource` succeeds — `APPLIANCE_CONTRIBUTED` entry or a POSTED capitalized
      expense). In-service date = `purchaseDate` (else `createdAt`) as a Denver date key, but never earlier than
      `booksStartDate` (use `booksStartDate` then) — design D-K9. Each in its own Serializable transaction via
      `enrollBookAssetInTx(tx, { kind: "automatic" }, id, key, "AUTOMATIC")`. An appliance that fails a condition is
      skipped and counted with its reason (1.4).
   c. **Depreciation**: for every BookAsset with `retiredOn = null` **that still has depreciation left** — new
      additive field `fullyDepreciatedOn DateTime?`, set by `postBookDepreciationInTx` when `remainingSchedule` comes
      back empty (cleared if the asset's life or salvage is changed) — and whose `lastDepreciationMonth` is before
      `lastCompletedMonth(now)` (or null): `postBookDepreciationInTx(tx, automatic, id, lastCompletedMonth(now), {
      maxMonths: 360 })`, one transaction per asset, at most 200 per night (ordered by `lastDepreciationMonth` asc nulls
      first, then id). Finished and up-to-date assets never take a slot, so the batch really rotates. Test: 200 fully
      depreciated assets + 1 still owing → the one is posted the first night; 450 owing → all done in 3 nights.
   d. Write `booksLastBroughtUpToDateAt = now`, `booksLastProblemCount = problems`, and
      `booksConsecutiveFailedNights = 0` (or +1 when any step threw) in one small transaction locking the settings row.
   Counts: `posted`, `enrolled`, `depreciated`, `skipped`, `problems`.
2. **`books-nightly:stripe` — only when `BOOKS_STRIPE_SYNC_ENABLED === "true"`**: today's `runStripeBooksNightly` code,
   unchanged.

### 1.4 To do items (new categories, group `taxes` = "Taxes & books" in `INBOX_GROUP`)
- `BOOKS_NOT_UP_TO_DATE` — when `booksConsecutiveFailedNights >= 1` (medium) or `>= 2` (high): "Your books didn't
  update last night", detail "We'll try again tonight. Open Books to see what stopped it.", href `/desk/books`.
- `BOOKS_NEEDS_FIX` — one item per skipped appliance or unpostable source, built from the autopilot's stored problem
  list. Store problems in a small table `BooksProblem` (additive: `id`, `kind` "APPLIANCE_NOT_ENROLLED" |
  "SOURCE_NOT_RECORDED", `subjectType`, `subjectId`, `message`, `firstSeenAt`, `lastSeenAt`, `resolvedAt`; unique
  `(kind, subjectType, subjectId)`; the nightly run upserts current problems and sets `resolvedAt` on ones that are
  gone). Item title: appliance → `"{assetNumber} isn't in your books yet"`, detail = the reason in plain words
  (no price → "Add what you paid for it on the appliance page."; no capital source → "Record how it was paid for
  (an expense or 'paid personally')."), href the appliance page; source → `"A {source words} couldn't be recorded"`,
  href the source page.
- `BOOKS_SETUP` (BA-2) and `BOOKS_MONTH_REVIEW` (BA-3) below.
Builders in `rules.ts`, queried in `getExceptionOverview` with the standard cap; every href is a real page.

### 1.5 Retirement and disposal connect automatically
- In `retireAppliance` (Equipment), inside the **same** transaction after the status update: if a `BookAsset` exists
  and is not retired, `postBookDepreciationInTx(tx, writer, id, min(retireMonth, lastCompletedMonth()), { maxMonths:
  360 })` then `retireBookAssetInTx(tx, writer, id, lockedAsset.version, "DECIDE_LATER", todayKey)` — the person
  writer passes the version it just read under the asset lock in this same transaction (section 1.2 keeps `null`
  for automatic writers only). The writer is the person who retired it. Test: an owner retiring an enrolled appliance
  from Equipment stages its book value (no savepoint fallback). If the book step throws (cost changed, missing capital source), the retirement still succeeds (wrap the
  book part in a savepoint: `tx.$executeRaw\`SAVEPOINT book_retire\`` / `ROLLBACK TO SAVEPOINT` on error) and a
  `BooksProblem` "APPLIANCE_RETIREMENT_NOT_RECORDED" is upserted → To do item. Never block taking a machine out of
  service because of books.
- `setRetiredPlan` choice changes update `BookAsset.retirementIntent`: `RetiredPlanChoice` is SELL, STRIP, SCRAP,
  DISPOSE, OTHER → intents SELL, STRIP, SCRAP, DISPOSE, DONATE_OTHER; choice `null` ("decide later") → DECIDE_LATER
  (a test asserts the map covers every enum value).
- **New:** `writeOffRetiredBookAssetInTx(tx, writer, applianceId, onDate, reason)` in `fixed-assets.ts`, called from
  `completeRetiredPlan` for every outcome that is not a sale (SCRAP, DISPOSE, OTHER, and STRIP once its remainder is
  SCRAPPED or THROWN_AWAY): lock the asset; require `retiredOn` set and `disposedOn` null (if not retired yet, retire it
  first exactly as above); `carried = retiredValueCents`; if `carried > 0` write one balanced entry
  `balancedPlan(onDate, "Retired appliance {assetNumber} {reason words}: book value removed", [{ role:
  "DISPOSAL_LOSS", debitCents: carried }, { role: "RETIRED_PENDING_DISPOSITION", creditCents: carried }])` with
  eventKind `"DISPOSED:" + cycle` where `cycle` = new additive field `BookAsset.disposalCycle Int @default(0)`
  incremented (under the asset lock) every time a disposal is posted, so complete → reopen → complete on the same date
  gets keys `DISPOSED:1`, `DISPOSAL_REVERSED:1`, `DISPOSED:2` (JournalEntry is unique on sourceType/sourceId/eventKind
  and `writeJournal` skips an existing key); set `disposedOn`; audit `books.asset.dispose` with the cycle. Scrap money received is already
  income through `recordScrapPayment` (unchanged). `reopenRetiredPlan` → `reverseBookAssetDisposalInTx`-style
  reversing entry with eventKind `"DISPOSAL_REVERSED:" + current cycle` and `disposedOn = null`. Test: complete →
  reopen → complete with the same date → three entries, value removed again, report matches the ledger.
- **Equipment reports must agree:** extend `disposedValueBefore` (`src/domains/books/fixed-assets.ts`) to read
  `DISPOSED:` and `DISPOSAL_REVERSED:` events too (today it reads only `SOLD:`/`SOLD_VOIDED:` and totals only
  `BOOK_VALUE_OF_APPLIANCES_SOLD`): add `DISPOSAL_LOSS` amounts for DISPOSED and subtract them for DISPOSAL_REVERSED,
  so `appliancePayback` (`reports.ts`) lowers `retiredValueCents` for scrapped/thrown-away appliances. Tests: report
  before disposal, after disposal, and after the plan is reopened (value back) — each matches the ledger.
- Shop sale of a retired appliance (`disposeRetiredBookAssetInTx`) no longer fails for "not staged": if the asset is
  not retired yet, retire it in the same transaction first (as above) — the error stays only for real conflicts.

### 1.6 Record right after big money events (best effort, design section 5)
After these commit — payment recorded (`recordManualPayment`), webhook payment recorded, refund, write-off, expense
posted, appliance purchase recorded — call `postForSource` for that one source in a **separate** short transaction
wrapped in `try/catch` (log via the existing system-issues reporter, never throw to the caller). Grep each function's
caller in `src/app` and add the call after the action's main transaction returns. A failure leaves it for tonight.

### 1.7 Tests (throwaway Postgres)
Nightly: posts pending sources; enrolls an eligible appliance with the right in-service date (purchase before books
start → start date); skips an ineligible one with one `BooksProblem` and one To do item; records 3 missed months
once and a re-run adds nothing; 360-month catch-up in one run; locked month → entry in the next open month marked
late (existing `journalPlacement`); Stripe half stays off without the switch while the record half runs;
concurrent nightly + manual depreciation → no duplicates (Serializable + unique keys). Retirement: retiring in
Equipment records depreciation through the retirement month and stages retirement; a book failure does not block
retirement and creates a problem; completing a scrap plan writes off the carried value to DISPOSAL_LOSS once;
reopening reverses it; a shop sale of a never-staged retired appliance succeeds and removes book value. Actor guard
test (no automatic writer in `src/app`).

## 2. BA-2 — first-time setup a new owner can finish

Route `/desk/books/setup` (OWNER; ADMIN sees "Ask the owner to set up the books"). Kit `Wizard` + `Stepper` (KIT 4.18,
built here if AR-4 has not). Steps exactly as design section 6:
1. "When did the business start doing business?" — date input, default = earliest of first appliance
   `purchaseDate`, first invoice `createdAt`, first expense date, today (one query each, min). InfoTip: "Pick the first
   day you want your records to cover. Most new businesses use the day the LLC was formed or the day they bought their
   first appliance."
2. "Is this a brand-new business with nothing in its accounts yet?" — `OptionCards`: **Yes** (recommended, "Starting
   balances are all $0.") / **No** (then three money inputs: "Business checking on that day", "Stripe balance on that
   day", "Business credit card owed on that day", each with an InfoTip "where do I find this?": bank statement ending
   balance; Stripe Dashboard → Balances; card statement balance).
3. "Did you pay for anything for the business with personal money?" — explanation InfoTip ("That counts as money you
   put into the business."), button "Add those expenses" → `/desk/expenses?paidFrom=owner#add-expense`: the expense form's "Paid
   from" select already offers the Owner contributions account (`systemRole: "OWNER_CONTRIBUTIONS"`,
   `src/domains/books/expenses.ts`); when `paidFrom=owner` preselect that account. And "Skip for now".
4. Review: plain summary + "Start my books" → existing `initializeBooks(actor, { startDate, stripeCents, bankCents,
   cardCents })` (unchanged) → then run `runBooksAutopilot(now)` immediately in the background of the request (await
   it with a 50-second budget; if it runs out, the nightly run continues) → redirect to `/desk/books` with toast
   "Your books are started. Everything since {date} is being recorded."
- To do `BOOKS_SETUP` (OWNER only, low until the business has its first invoice, then medium): "Set up your books (5
  minutes)" → `/desk/books/setup`, while `booksStartDate` is null.
- **Correct starting balances** (`correctOpeningBalances(actor, { stripeCents, bankCents, cardCents, reason })` in
  `management.ts`, OWNER): one Serializable transaction; requires books started; computes the difference from the
  current opening amounts (sum of OPENING_BALANCE plus earlier corrections per account role); writes one balanced
  entry with eventKind `OPENING_CORRECTED_{n}` (n = count of earlier corrections + 1) dated `booksStartDate` placed by
  `journalPlacement` (late if that month is locked); reason required (≤ 300); audit `books.opening.correct`. Never
  edits the original. UI: on Books home ⋯ "Correct my starting balances" → Sheet.
- Remove the "cannot be redone" text from the old form (the old form is replaced by the wizard).
Tests: new-business path makes the zero opening and the start date; correction posts only the difference and lands
late when the start month is locked; second correction numbers itself 2; admin refused for start and correct; the To
do item clears.

## 3. BA-3 — "Review this month"

### 3.1 Data (same migration)
`AccountingPeriod.reviewNotes Json?` (`{ check: "expenses" | "payments", reason: string, byUserId, at }[]`),
`accountantSentAt DateTime?`; `BusinessSettings.booksReviewReminderDay Int @default(15)` (1–28, owner setting with
"restore recommended"), `accountantEmail String?` (owner setting; validated email).

### 3.2 To do `BOOKS_MONTH_REVIEW`
One item per ended, not-closed month from the books start month through last month: title "Review {Month YYYY}'s
books", medium, high after `booksReviewReminderDay` of the following month (Denver dates), href
`/desk/books/months/{YYYY-MM}`. Created by the query itself (no stored rows): ended months = from
`booksStartDate`'s month to `lastCompletedMonth(now)`, minus `AccountingPeriod` rows with status CLOSED.

### 3.3 Page `/desk/books/months/[month]` (OWNER/ADMIN view; OWNER locks)
`monthReview(actor, key)` in `src/domains/books/month-review.ts` returns four checks:
1. **Everything was recorded** — 0 pending sources for the month (the same query `postPending` uses, restricted to
   source dates in the month) and 0 open `BooksProblem` of kind SOURCE_NOT_RECORDED for sources in the month.
2. **Expenses are complete** — 0 expenses with status DRAFT or SUBMITTED dated (`spentOn`) in the month; every
   POSTED expense in the month has `receiptPhotoId` or a `noReceiptReason`. There is no "no receipt" field today: add
   `Expense.noReceiptReason String?` (same migration) and, on the expense form and expense page, a "No receipt for
   this one" checkbox that reveals a required reason (≤ 200), saved through the existing expense save function (add
   the field to its zod schema; audit unchanged pattern).
3. **Payments add up** — two parts, each "Matched", "Not set up yet" or "Off by {amount}":
   - **Bank:** for each `CashAccount` that has at least one `BankImport`, a current (`isCurrent`) `BankReconciliation`
     with status `COMPLETED` covering the month (`fromOn` ≤ month start and `toOn` ≥ month end) → Matched; otherwise
     count `BankObservation` rows of that account with `postedOn` in the month and status `UNMATCHED` → "Off by" the
     sum of their amounts (or "{n} bank lines not matched yet"). No `BankImport` at all → Not set up yet.
   - **Stripe:** only when `BOOKS_STRIPE_SYNC_ENABLED === "true"`: `checkStripeClearing(endOfMonth)` → MATCH = Matched,
     DIFFERENCE = "Off by {differenceCents}", UNKNOWN = its reason. Otherwise Not set up yet.
   "Not set up yet" passes the check with the line "You haven't connected Stripe or bank statements; you can do it
   later." (`BankReconciliation.status` values in code: DRAFT, COMPLETED, REOPENED; observation status values: UNMATCHED,
   MATCHED, IGNORED, SUPERSEDED — only UNMATCHED counts as not matched.)
4. **Equipment value recorded** — every BookAsset not retired before the month's end has a `DEPRECIATION:{key}` entry
   (or its schedule had ended).
Then "Your month in plain words": billed, collected, spent, profit (existing `profitAndLoss` for the month, accrual)
vs the previous month, and "Your biggest costs were {top 3 expense accounts}". Then **Send it to your accountant**:
"Download the month package" (existing `exportMonthReview` CSV + P&L) and, when `accountantEmail` is set, "Email it to
my accountant" (OWNER; never automatic; sets `accountantSentAt`). Send with `sendEmail` from `src/lib/email.ts` (the
system path; the customer-email switch does not apply to it — it goes only to the business's own accountant). It has
no attachment support today: add an optional `attachments?: { filename: string; content: Buffer }[]` passed straight
to Resend's `emails.send` `attachments` field, and send the month CSV and the P&L CSV. Respect its `outcome` (`EmailOutcome`):
only `SENT` sets `accountantSentAt`; `UNKNOWN` shows "We couldn't tell if it was sent — check with your accountant
before sending again"; `REJECTED` shows "The email service refused it. Nothing was sent; try again later.";
`NOT_ATTEMPTED` shows "Email isn't set up on this app yet — download the package instead." (AI-PR-READ-FIRST item 3).
Then **Lock {Month}** (OWNER): disabled while check 1 or 4 fails (reason shown); checks 2 and 3 failing need a typed
reason each (stored in `reviewNotes`). Lock calls a new `closeAccountingMonthWithReview(actor, key, notes)` that, in
one transaction, runs the existing `exportMonthReview` step for any entries not yet exported (the existing close
refuses unexported entries) and then the existing close logic, and stores `reviewNotes`. After locking: "Locked on
{date}" + "Unlock" (existing reopen, reason required).
Tests: the item exists only for ended unlocked months; lock refused while sources are pending; override reasons
required and stored; email only to the saved address, only on press; admin can view but not lock; severity flips on
the reminder day (DST edges); locking exports and closes in one transaction.

## 4. Cards
BA-1, BA-2, BA-3 each one PR in that order (BA-2 and BA-3 depend on BA-1's actor refactor). BA-4/5 screens are AR-7.
