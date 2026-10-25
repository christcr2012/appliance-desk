# Books on autopilot — the app keeps the books; the owner reviews once a month (Batch BA)

Status: **designed 2026-10-25 at Chris's request; not built.** Units BA-1…BA-6 are listed in `work-index.json`
(execution cards are written when each one starts). Nothing here turns on a provider, moves money or changes past
entries. It builds on the merged Batch K / K-CASH engine ([BATCH-K.md](BATCH-K.md), [BATCH-K-CASH.md](BATCH-K-CASH.md));
it does not replace their accounting rules.

## 1. The problem, in Chris's words (2026-10-25)

> "This page makes no sense to me. It's just a long list of … account entries? There seems to be no coherent
> workflow … depreciation 'through' is on one of the fields, but you can change the field, so what about the next
> time on a different date … This seems to be a list of functionality all placed in one spot, rather than built into
> the system so that Appliance Desk manages it instead of the user."

Design target he set: **a first-time business owner can run a brand-new company easily.** That owner has no
bookkeeping training, does not know what a debit is, and should never need to.

## 2. What the code does today (checked against `main`, 2026-10-25)

| Area | Today | Where |
|---|---|---|
| Books home `/desk/books` | Raw journal (date, source, debit/credit lines, 30 per page), a "Bring the books up to date" button, lock/unlock month forms, the account list with rename + QuickBooks/Xero mapping, "add an account". Six sub-page links in a row. | `src/app/desk/books/page.tsx` |
| Recording entries | **Only happens when someone presses "Bring the books up to date", creates an export, or the nightly Stripe job runs** — and the nightly job is switched off until `BOOKS_STRIPE_SYNC_ENABLED=true`. So the page's claim "it fills itself in" is not true unless a button is pressed. | `postPending` in `src/domains/books/post.ts`; `src/app/api/cron/books-nightly/route.ts` |
| Equipment depreciation `/desk/books/assets` | Owner must **enroll each appliance by hand**, typing an "in-service date", then press **"Post depreciation" per appliance** with a "Through Colorado month" field (max 12 months per press). The engine itself is correct: each appliance remembers its last recorded month, so a later "through" date only adds the missing months and never double-counts — but the screen never says so. | `src/domains/books/fixed-assets.ts`, `depreciation.ts` |
| Retiring an appliance | The fleet's retirement workflow (M-2A/M-2B) and the Books "Record pending-retirement asset" form are **separate**; retiring a machine in Equipment does not stop its book depreciation. | `retireBookAsset` has no caller outside the Books page |
| Month-end | Lock/unlock buttons only. No reminder, no checklist, nothing on To do. | `closeAccountingMonth` in `management.ts` |
| First setup | One form: start date + three balances, with a warning that it "cannot be redone". No guidance for a brand-new business. | `initializeBooks` |
| Other Books pages | Budget backing (K-CASH envelopes), bank statements, cash forecast + customer health + year-end, exports with a QuickBooks trial checklist, reports — written in accountant/engineering words ("Required protected obligations", "source-backed report", "collected facts"). | `src/app/desk/books/*` |

**Drift from the approved design.** [BATCH-K.md](BATCH-K.md) already said the poster runs nightly (§2, "nightly
automation"), that depreciation entries are created "for every month that has ended" (§3.7), and that the in-service
date is the purchase date (D-K9). The build made all three manual. This design restores the original intent and adds
the owner workflow that was never designed.

## 3. Principles for every BA unit

1. **The app does the routine work; the owner reviews.** Anything the app can know (what was bought, when, for how
   much, what was billed and paid, what month has ended) it records itself. The owner is asked only for things only a
   person knows (a receipt, a judgment call, "yes, this month looks right").
2. **One clear path, shown as To do items.** The owner never has to remember to visit Books. When something needs
   them, it appears on Today with one button that opens the exact step.
3. **Quiet screens** (Chris, 2026-10-25: "I can't have you filling up my screens with explanations"). At most one
   short line under a title; every explanation goes behind an ⓘ (`InfoTip`). The wording examples in this document
   are tooltip or label text, not paragraphs to print on the page.
   **Plain words first, accountant words second.** Every screen leads with what it means for the business ("You made
   $1,240 profit in October"). Debits, credits, journal numbers and account codes live under "For your accountant".
4. **History never changes.** Unchanged K rules: entries are never edited or deleted; corrections are new entries;
   locked months stay locked; late items go into the next open month with "late for <date>".
5. **Fail loudly, never silently.** If an automatic step cannot finish (missing cost, unbalanced source, provider
   down), it shows as a To do item with what is wrong and where to fix it, and the Books home says "not up to date".
6. **Owner-configurable with sensible starting values** (AGENTS section 4): life in months, salvage %, reminder day,
   accountant email — each explained on screen with "restore recommended".
7. **No bare link lists — every destination explains itself** (Chris, 2026-10-25: links "plastered" on pages make
   the system look like an informational website, and "nobody knows what they are for … why would somebody need to
   click them and when?"). Navigation inside a feature is a **tab bar** or **task cards**, never a row of underlined
   words. A task card has: a short title, a live status badge ("Up to date", "2 need you", "Not set up yet",
   "Locked"), an ⓘ that explains what it is for and when you would use it, and one large tap target. Most visits should start from a
   To do item, not from browsing. Inline text links stay only inside a sentence where they explain themselves. Rule
   recorded in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md); BA-6 applies it to the rest of the desk.
8. **Book value is not tax value.** Keep the existing disclaimers and CPA evidence gates; book depreciation never
   becomes IRS basis or recapture (unchanged from K-6 and the resale-tax design).

## 4. The owner's experience after BA (a first-time owner's month)

1. **Day 1 of using the app:** Today shows "Set up your books (5 minutes)". The guided setup asks *one question at a
   time* (section 6). A brand-new business answers "I'm starting fresh" and is done.
2. **During the month:** nothing to do in Books. Bills, payments, refunds, expenses, appliance purchases, Stripe fees
   and depreciation are recorded automatically every night. The Books home always says when it was last brought up to
   date ("Up to date as of today, 3:40 am").
3. **Problems appear on Today**, e.g. "2 expenses are missing a receipt", "A payment could not be matched to a bill",
   "Washer W-014 has no purchase price, so its value can't be tracked".
4. **On the 1st of the next month:** the app records last month's depreciation for every rental appliance, and Today
   shows **"Review October's books"**. One guided page (section 7) walks through 4 checks with green ticks, shows
   October's profit in plain words, lets the owner download or email the accountant package, and ends with **"Lock
   October"**. The To do item disappears when the month is locked.
5. **If they forget:** the item turns urgent after the reminder day (starting value the 15th) and stays until done.
6. **At year end:** the December review also offers the year-end package for the accountant (existing K-8 files).

## 5. BA-1 — Automatic recording (the engine runs itself)

**Nightly job.** Split `books-nightly` into two halves:

- **Always (once books are started):** `postPending()` for all sources; auto-enroll new appliances (below); record
  every completed month's depreciation for every active book asset (below); create recurring expense drafts (already
  in `expense-drafts`, unchanged); then refresh the Books freshness marker and To do items.
- **Only when the owner turned Stripe sync on (`BOOKS_STRIPE_SYNC_ENABLED`):** the existing read-only Stripe balance
  import and clearing check. Unchanged.

Same 3:40 am Denver schedule, `runAutomation` budget/retry rules, and system-issues reporting as today. Each half is
idempotent (existing unique `sourceType/sourceId/eventKind` keys), so a re-run or missed night only catches up.

**Auto-enroll appliances.** An appliance is enrolled automatically, with no owner step, when all are true: books are
started; it has a positive `acquisitionCostCents`; its acquisition is in the books (`APPLIANCE_CONTRIBUTED` entry or a
posted capitalized expense — the existing `verifyCapitalSource` rule); it is not retired or sold; it is not already
enrolled. Values:

- **In-service date** = the purchase date (`purchaseDate`, else `createdAt`), or the books start date if the purchase
  was earlier (D-K9). Recorded as `enrollmentSource = AUTOMATIC`.
- **Life / salvage** = the appliance type's life, else the business default (60 months, 0%), as today.
- If any condition fails, the appliance is skipped and a To do item says exactly why ("Dryer D-003 has no purchase
  price — add it on the appliance page"), linking to the page that fixes it.
- The owner can still change one appliance's life or salvage later (future months only — existing
  `setBookAssetPolicy`).

**Automatic monthly depreciation.** For every enrolled, unretired asset, record all completed months up to
`lastCompletedMonth()` using the existing `postBookDepreciation` engine (straight-line, first month after the
in-service month, last month absorbs rounding, 12-month catch-up chunks repeated until current). Actor is the
fixture-free automation identity already used by other jobs, recorded in the audit log as "automatic".
If a month is locked, the existing `journalPlacement` puts the entry in the next open month marked "late for".

**Retirement connects automatically.** When an appliance is retired in Equipment (M-2A `RetiredAppliancePlan`), the
same transaction first records any completed months of depreciation through the retirement month, then calls
`retireBookAsset` with the plan's intent. Sale (M-2C) already disposes the book value. The separate Books form goes away.

**Freshness and failure.** Store `booksLastBroughtUpToDateAt` and `booksLastProblemCount` on `BusinessSettings` after
each run. A failed or partial run creates one `BOOKS_NOT_UP_TO_DATE` To do item (high after 2 missed nights).
"Things the books could not record" (existing issues) each become a `BOOKS_NEEDS_FIX` To do item with the source link.

**Also record right after the big money events.** After a payment, refund, write-off, expense post or appliance
purchase commits, call `postForSource` for that one source in a separate best-effort step (never inside the money
transaction; a failure just leaves it for tonight). This keeps the Books home current during the day.

Tests (throwaway Postgres): nightly run posts pending sources, enrolls an eligible appliance, records 3 missed months
once and is a no-op on re-run; ineligible appliance yields one To do item, no asset; retiring in Equipment freezes
depreciation and records through the retirement month; locked month → late entry in next open month; Stripe half
stays off without the switch while the always half runs; concurrent nightly + manual run creates no duplicates.

## 6. BA-2 — First-time setup that a brand-new owner can finish

Replace the single "Start your books" form with a short guided flow on `/desk/books/setup`, shown as the To do item
`BOOKS_SETUP` until done:

1. **"When did the business start doing business?"** Pre-filled with the earliest of: first appliance purchase, first
   invoice, first expense, or today. Plain help: "Pick the first day you want your records to cover. Most new
   businesses use the day the LLC was formed or the day they bought their first appliance."
2. **"Is this a brand-new business with nothing in its accounts yet?"**
   - **Yes (recommended for a new business):** checking $0, Stripe $0, credit card owed $0. Done.
   - **No:** enter each balance *as of that day*, with a "where do I find this?" tip for each (bank statement ending
     balance, Stripe Dashboard → Balances, card statement balance).
3. **"Did you pay for anything for the business with personal money?"** Explains that appliances or expenses paid
   personally are recorded as money the owner put into the business ("Owner contributions" — existing account and
   `APPLIANCE_CONTRIBUTED` rule); links to add them as expenses marked "paid personally". Can be skipped.
4. **Confirm:** a plain summary, then "Start my books". The automatic engine then catches up everything since the
   start date that night (or immediately with a "Do it now" button).

**Fixing a starting balance later.** Remove the frightening "cannot be redone". Add "Correct my starting balances" for
the owner: it records one new balanced correcting entry (`OPENING_CORRECTED_<n>`) for the difference, dated on the
start date if that month is open, otherwise placed by `journalPlacement` in the next open month as "late for <start
date>". Requires a reason; audited; never edits the original opening entry.

Tests: new-business path creates the zero opening entry and the start date; correction posts only the difference and
respects locked months; admin cannot start or correct (owner only, as today); To do item clears on completion.

## 7. BA-3 — "Review this month" (month-end close as a guided workflow)

**When.** On the 1st of each month (after that night's run), for the month that just ended and every earlier unlocked
month since the start date, create one `BOOKS_MONTH_REVIEW` To do item per month: "Review October's books". Medium
until the reminder day (`booksReviewReminderDay`, starting value **15**, range 1–28), high after it.

**Page** `/desk/books/months/[YYYY-MM]` — four automatic checks, each a green tick or a plain problem with a fix link:

1. **Everything was recorded** — no pending sources and no open "could not record" issues for the month.
2. **Expenses are complete** — no unsubmitted drafts dated in the month; every posted expense has a receipt or the
   owner ticked "no receipt for this one" (existing expense fields).
3. **Payments add up** — Stripe and bank checks from K-3/K-CASH-3 for the month: "matched", "not set up yet" (allowed,
   with a one-line explanation and a link to set it up later), or "difference of $X" (must be explained or fixed).
4. **Equipment value recorded** — depreciation entries exist for every active rental appliance for the month.

Then **"Your month in plain words"**: money billed, money collected, money spent, profit (accrual, from the existing
`profitAndLoss`), compared with the previous month, plus "Your biggest costs were …".

Then **"Send it to your accountant"**: download the month package (existing month CSV + P&L) or, if
`accountantEmail` is set, "Email it to my accountant" (sends only to that address through the existing staff email
path; never automatic; records that it was sent). Optional step.

Then **"Lock October"** (owner only — existing `closeAccountingMonth`). Disabled while check 1 or 4 fails; checks 2
and 3 can be overridden with a typed reason ("No receipt; paid in cash at the dump"), stored with the period. After
locking, the To do item clears and the page shows "Locked on …" with "Unlock" (existing, reason required).

Data: `AccountingPeriod.reviewNotes Json?` (overrides + reasons), `accountantSentAt DateTime?`;
`BusinessSettings.booksReviewReminderDay Int @default(15)`, `accountantEmail String?`.

Tests: item appears on the 1st only for ended unlocked months; lock refused while unrecorded sources exist; override
reasons required and stored; email goes only to the saved accountant address and only on press; admins can view and
prepare but not lock; reminder severity flips after the reminder day (Denver dates, DST edges).

## 8. BA-4 — Books home and page layout a beginner understands

**New Books home** `/desk/books` (owner/admin):

- **Status line:** "Up to date as of today 3:40 am" or "Not up to date — 3 things need you" (links to To do).
- **This month so far** and **last month**: billed, collected, spent, profit — in dollars, with one sentence each.
- **Needs your attention:** the Books To do items (setup, month reviews, fixes).
- **Coming up:** next month review, next sales-tax filing (existing tax calendar), year-end package availability.
- **Four task cards** (replacing today's row of six underlined links): title + status badge + ⓘ (the quoted
  sentences below are the ⓘ text, not on-screen copy), plus the same four as a tab bar at the top of every Books page:
  1. **Month by month** — "Do this once a month: check, send to your accountant, lock." Badge: "October ready to
     review" / "All months locked". Opens the list of months (Open / Ready to review / Locked) → BA-3 page.
  2. **Reports** — "Use this when you want to know how the business is doing: profit, what you own and owe, which
     appliances have paid for themselves, cash coming up, who pays on time." Badge: "October profit $1,240".
     (Existing K-7/K-8 reports, re-labelled; forecast and customer health move here from "closing".)
  3. **Equipment value** — "Use this to see what your rental appliances are worth on paper. The app keeps it up to
     date." Badge: "24 appliances, all recorded" / "1 needs a purchase price". → BA-5.
  4. **For your accountant** — "Use this when your accountant asks for something." Badge: "October package ready".
     Contains the full journal (today's table, unchanged data), account names and QuickBooks/Xero
     matching, exports and the QuickBooks trial checklist, year-end package, per-appliance tax evidence, bank statement
     imports. One sentence at the top: "Your accountant may ask for these. You don't need them to run the business."
- **Expenses** is not a Books link at all: adding an expense or a receipt is a Money/Today action ("Add an expense"
  button and To do items), because it happens day to day, not during bookkeeping.
- **Budget envelopes (K-CASH)** stay where they are, shown as a fifth card only after the owner turns budgets on
  (it is OFF by default per K-CASH); wording pass only, no behavior change.

**Wording pass** across every Books page (plain-words lint already enforces part of this): e.g. "Budget backing" →
"Money set aside", "Required protected obligations" → "Bills you must keep money for", "source-backed report" → removed,
"Customer health — collected facts" → "Who pays on time". Account `type` codes show as "Something you own / owe /
earn / spend". Journal stays available, with "debit/credit" explained in one tooltip.

"Bring the books up to date" becomes a small secondary "Update now" link (owner/admin) next to the status line.

Tests/browser: phone width, keyboard, axe on the new home and the four doors; admins never see owner-only actions;
every old Books URL still works (redirect or same page); no Today item links to a missing page.

## 9. BA-5 — Equipment value (depreciation) screen with nothing to remember

`/desk/books/assets` becomes **"What your rental equipment is worth"**:

- One row per appliance: what you paid, value recorded so far, value now, months left, "next automatic entry: Nov 1".
  Totals at the top ("Your 24 appliances cost $9,600 and are now worth $8,120 on your books").
- **No "enroll" form and no "post through" field.** Enrollment and monthly entries are automatic (BA-1). Appliances
  the app could not enroll are listed first with the reason and a fix link.
- **Settings card:** "How long appliances last on your books" (starting value 60 months) and "Value left at the end"
  (0%), explaining that changes apply to newly bought appliances; per-appliance "Change how long this one lasts"
  (future months only — existing rule) under a "More" menu.
- **Retiring/selling** happens in Equipment (M-2) — this page just shows "Retired on … held for sale / sold on …".
- Tax evidence fields (basis, Section 179, bonus, CPA name) move to "For your accountant", per appliance, unchanged.
- Recovery: if the nightly job is failing, an owner-only "Record missing months now" button runs the BA-1 step for all
  assets (same idempotent engine), so nothing depends on one appliance at a time.

Tests: list totals equal the ledger (fixed-asset cost minus accumulated depreciation accounts); ineligible appliances
listed with reasons; life change affects only future months; no manual enroll/post path remains for routine use.

## 9a. BA-6 — No more bare link lists anywhere on the desk

Apply principle 7 to every desk page that still shows rows of underlined navigation links. On 2026-10-25, 21 desk
files contained them (found with `className="underline" href`): sales-tax audit pack, returns list and return page,
sales-tax setup, purchase detail, the rental wizard, the account two-step card, expenses, signing-charge form, website
settings (page, review and history panels), telecom controls, the appliance tax-proof panel, and the Books pages
(cash checks, assets, exports, home, budget and its review section, money trends). For each: turn page-to-page
navigation into a tab bar (sibling pages) or task cards (purpose + when + status), turn "go do X" links into buttons
on the To do item or the record they belong to, and keep only self-explaining links inside sentences. Add a lint/test
guard that fails when a desk page renders three or more consecutive bare navigation links. No behavior changes.

Tests/browser: the guard; phone width, keyboard focus order and axe on every changed page; every old URL still reachable.

## 10. Data changes (additive only)

- `BookAsset.enrollmentSource String @default("OWNER")` (`AUTOMATIC` | `OWNER`), backfilled `OWNER` for existing rows.
- `BusinessSettings`: `booksLastBroughtUpToDateAt DateTime?`, `booksLastProblemCount Int @default(0)`,
  `booksReviewReminderDay Int @default(15)`, `accountantEmail String?`.
- `AccountingPeriod`: `reviewNotes Json?`, `accountantSentAt DateTime?`.
- New journal event kind `OPENING_CORRECTED_<n>` (source `OPENING`), posting rule in `posting-rules.ts`.
- New To do categories: `BOOKS_SETUP`, `BOOKS_NOT_UP_TO_DATE`, `BOOKS_NEEDS_FIX`, `BOOKS_MONTH_REVIEW`,
  `BOOK_ASSET_NEEDS_INFO` (pure rules in `src/domains/exceptions/rules.ts`, wired in `index.ts`, labels in `todo.ts`).

## 11. Build order and sizing

BA-1 (engine runs itself) → BA-2 (setup) → BA-3 (month review) → BA-4 (home and layout) → BA-5 (equipment value)
→ BA-6 (link lists across the desk; can run in parallel with BA-1…BA-3 because it touches only page layout).
BA-1 first because it fixes the real gap (nothing is recorded unless a button is pressed). Each is one complete PR
with tests; BA-4 and BA-5 may share a PR if both are small. No unit needs a purchase, a provider change or a live switch.

## 12. Owner decisions

None required to build. Engineering defaults, each a setting Chris can change: in-service date = purchase date
(D-K9; CPA may confirm), review reminder on the 15th, accountant email blank, emailing the accountant only on press.
Book depreciation remains management-only; the CPA decides tax depreciation (unchanged).

## 13. Out of scope (see ROADMAP)

Automatic bank feeds (Plaid or similar — paid provider), payroll, income-tax return preparation, multi-currency,
direct QuickBooks Online sync (deferred per Batch K), and AI categorization of expenses.
