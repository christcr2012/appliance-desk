# Screen spec — Money › Books and Money › Taxes (AR-7, replaces design units BA-4, BA-5, BA-6 for these pages)

Design: `docs/designs/BOOKS-AUTOPILOT.md` sections 8–9a (Books home, Equipment value, no bare links) and
`APP-REDESIGN.md` section 6 (Taxes regrouped). Needs **BA-1** (automatic recording) merged; BA-2/BA-3 pages are
specified in `engines/BOOKS-AUTOPILOT.md`. Roles unchanged: Books and Taxes OWNER/ADMIN; owner-only actions stay
owner-only. **No accounting or tax rule changes** — every page keeps calling the same domain functions; this is
layout, words, and the summary reads listed here.

## 1. Books — sub-tabs (inside Money › Books)

A second-level tab strip (`AreaTabs` variant "sub") on every Books page: **Overview** `/desk/books` · **Month by
month** `/desk/books/months` · **Reports** `/desk/books/reports` · **Equipment value** `/desk/books/assets` · **For
your accountant** `/desk/books/accountant` · (**Money set aside** `/desk/books/budget` only when budgets are on —
`cashBudgetEnabled`, AR-12 feature). Old URLs: `/desk/books/closing` → `/desk/books/reports?view=cash-and-customers`;
`/desk/books/exports` and `/desk/books/export` → render inside For your accountant (same pages, new frame);
`/desk/books/cash` and `/desk/books/cash/checks` → inside For your accountant › Bank statements.

### 1.1 Overview `/desk/books`
Data `getBooksHome(actor, now)` in `src/domains/books/home.ts` (OWNER/ADMIN): `{ started: boolean; lastUpToDateAt;
problemCount; thisMonth: { billedCents, collectedCents, spentCents, profitCents }; lastMonth: same; monthsToReview:
string[]; nextTaxDue: { label, dueOn } | null }` — months from `profitAndLoss(actor, { from, to, basis: "ACCRUAL" })`
(billed = income total, spent = expense total; collected = `collectedBetween(null, from, to).netCents`); next tax due
from `getTaxWorkspaceOverview` (its first DUE/OVERDUE item).
Layout: not started → one `EmptyState` "Set up your books (5 minutes)" + button → `/desk/books/setup` (owner) or "Ask
the owner to set up the books" (admin). Started:
- Status line: "Up to date as of {relativeBusinessDay} {time}" (good) or "Not up to date — {n} things need you"
  (attention, link → `/desk/today?group=taxes`); small secondary "Update now" (existing "bring up to date" action).
- `StatStrip`: "Billed this month", "Collected", "Spent", "Profit" (attention when negative), each with a second line
  "Last month {amount}". InfoTip on Profit: "Billed minus spent this month (accrual). Your accountant may use a
  different method for taxes."
- "Needs your attention": the To do items of kinds BOOKS_* (`InboxCard`, same actions as Today), none → nothing.
- "Coming up": "Review {month}" (if any), "Sales tax due {formatShortDate}" (if any), each a row with one button.
- Four **task cards** (kit `TaskCard` = `{ title, status: { label, tone }, info: string, href }`, one large tap
  target, no underlined links): Month by month (status "{Month} ready to review" / "All months locked"), Reports
  ("{Month} profit {amount}"), Equipment value ("{n} appliances, all recorded" / "{n} need a purchase price"), For your
  accountant ("{Month} package ready" / "Nothing new"). The InfoTip texts are the quoted sentences in design 8.
- ⋯: "Correct my starting balances" (owner, BA-2).

### 1.2 Month by month `/desk/books/months`
List of months from the books start to the current month: `"{Month YYYY}"` · pill Open (neutral) / Ready to review
(attention; ended and not closed) / Locked (good) · button "Review" → `/desk/books/months/{key}` (BA-3 page).

### 1.3 Reports `/desk/books/reports`
Keep the existing report functions; regroup into views (`?view=`): `profit` (default; `profitAndLoss` with month
picker and compare), `own-owe` (`balanceSnapshot`, words "What the business owns" / "What it owes" / "What's left
for you"), `payback` (`appliancePayback`, "Which appliances have paid for themselves"), `cash-and-customers` (the
existing closing page content: cash forecast, customer health → "Who pays on time", year-end). View switcher =
`SegmentedControl` on desktop, `Select` on phone.

### 1.4 Equipment value `/desk/books/assets` — "What your rental equipment is worth"
Data from `getBookAssets` plus `BooksProblem` rows of kind APPLIANCE_NOT_ENROLLED (BA-1). Top: sentence-style totals
in a `StatStrip`: "Cost {sum}", "Worth on your books now {sum}", "Recorded through {month}". List: problems first
(attention cards "{assetNumber}: {reason}" + "Fix" → appliance page); then one row per asset: appliance number +
type · "Paid {cost}" · "Worth now {cost − recorded}" · "{months left} months left" · pill Active / Retired {date} /
Sold {date} · ⋯ "Change how long this one lasts…" (existing `setBookAssetPolicy`, future months only, Sheet). Settings
card (kit `SettingRow` × 2): "How long appliances last on your books" (default 60 months) and "Value left at the
end" (0%) → existing `setBookDepreciationDefaults`, each with "Restore recommended" and the note "Applies to
appliances added from now on." Owner-only "Record missing months now" in ⋯ (runs the BA-1 depreciation step for all
assets). **Remove** the enroll form, the per-appliance "Post depreciation" form and the "Record pending-retirement
asset" form (BA-1 automates them; the server actions stay for the accountant page's recovery use only — move them
there behind "Fix a book asset by hand" for the owner). Tax evidence fields move to For your accountant.

### 1.5 For your accountant `/desk/books/accountant` (new frame page)
One line under the title: "Your accountant may ask for these. You don't need them to run the business." Sections as
`TaskCard`s: "Full journal" (today's journal table, unchanged data, debit/credit InfoTip), "Accounts and
QuickBooks/Xero names" (existing rename/map/add account forms), "Exports" (existing exports page content and the
QuickBooks trial checklist), "Year-end package" (existing), "Bank statements" (existing cash pages), "Book asset tax
details" (existing `addBookTaxEvidence` per appliance), "Fix a book asset by hand" (owner).

### 1.6 Words (Books)
"Books", "Overview", "Month by month", "Reports", "Equipment value", "For your accountant", "Money set aside", "Up
to date as of {when}", "Not up to date — {n} things need you", "Update now", "Billed this month", "Collected",
"Spent", "Profit", "Last month {amount}", "Needs your attention", "Coming up", "Ready to review", "Locked", "Review",
"What the business owns", "What it owes", "What's left for you", "Which appliances have paid for themselves", "Who
pays on time", "What your rental equipment is worth", "Worth now", "months left", "How long appliances last on your
books", "Value left at the end", "Restore recommended", "Record missing months now", "Fix a book asset by hand", and
the design 8 wording pass: "Budget backing" → "Money set aside", "Required protected obligations" → "Bills you must
keep money for", "source-backed report" → removed, "Customer health — collected facts" → "Who pays on time"; account
types ASSET "Something you own", LIABILITY "Something you owe", EQUITY "Your share", INCOME "Money earned",
EXPENSE "Money spent", CONTRA_* "Reduces {parent words}". The accountant pages are exempt from the plain-words list
(AR-12) but keep these labels where they are visible.

## 2. Taxes — sub-tabs (inside Money › Taxes)

Sub-tabs: **Overview** `/desk/sales-tax` · **Returns** `/desk/sales-tax/returns` (and `[periodId]`, `amend`) ·
**Areas & rates** `/desk/sales-tax/areas` (+ delivery fees `/desk/sales-tax/delivery-fees` as a section) ·
**Exemptions** `/desk/sales-tax/exemptions` · **Use tax** `/desk/sales-tax/use-tax` (+ `[periodId]`, `settings`) ·
**Setup** `/desk/sales-tax/setup` (+ `accounts/[id]`, `taxability`, `record-retention`, `audit-pack`). Every URL
stays; each page renders inside the frame.
### 2.1 Overview `/desk/sales-tax`
Data unchanged (`getTaxWorkspaceOverview` + `includeTodayTaxAttention`). Layout: `StatStrip` "Next return due
{date}", "Collected this period {amount}" (if the projection has it; otherwise omit), "Decisions open {n}" (from
DEC-1 when merged: subjects in area TAX not CONFIRMED; link → Decisions & reviews For your CPA); then the attention
list as `InboxCard`s with the existing kind labels (OVERDUE "Past due", AMENDMENT "Amendment", DUE "Due soon",
NOT_READY "Filing not ready", SETUP "Setup", INFO "Review"); then the budget card (existing `BudgetContextCard`, only
when budgets are on). Remove the two explanatory sentences (move to an InfoTip on the title: "Your Colorado filing
setup, upcoming returns and tax decisions. Filing and paying stay your own actions.").
### 2.2 Other tax pages
Apply KIT layout per page type: lists (returns, exemptions, use-tax periods) → `DataTable` + `StatusTabs` where the
page already filters by status; record pages (return period, setup account) → `RecordHeader` + sections; forms →
`SettingRow`s. Replace bare link rows with tabs or task cards (design 9a list: audit pack, returns list and return
page, setup). No calculation, filing or evidence behavior changes. Where a page shows a "CPA date required" block,
show instead the DEC-1 provisional state ("Starting value — not confirmed by your CPA") once DEC-1 has landed; until
then keep the existing text.

## 3. Guard and tests
- Add every Books and Taxes page to `docs/build-specs/migrated-pages.json` (KIT guards, incl. no bare link lists and
  no paragraph over 140 characters).
- `tests/books-home.test.ts` (summary numbers equal the P&L and collected functions on a fixture), browser spec
  `e2e/books-taxes.spec.ts`: every old URL renders inside its frame; task cards; equipment list totals equal the
  ledger (rental equipment cost − accumulated depreciation); owner-only actions absent for admins; axe + 5 sizes.
