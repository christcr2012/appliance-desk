# Screen spec — Insights: Customers › Insights, Equipment › Insights, Money › Overview additions (AR-9)

Built in **AR-9**. Design: `APP-REDESIGN.md` 4.1 ("Insights are a tab inside each area"), 4D.5 ("Not enough data
yet…"), 7 (Growth → Customers Insights; dashboard/control-center content → Today header + area Insights). This card
also delivers **LD-4** (lead insights, `docs/designs/LEADS-WORKSPACE.md` section 7) and the insights half of **CU-3**
(`docs/designs/CUSTOMERS-WORKSPACE.md` section 6; its area/search half was built by AR-1/AR-4). Kit: KIT.md
(`ScreenHeader`, `AreaTabs`, `StatStrip`, `DataTable`, `EmptyState`, `InfoTip`). Depends on AR-3 (Money Overview at
`/desk/money`), AR-4 (Customers area), AR-6 (Equipment area), LD-1 (`Lead.firstContactedAt`, stages).

Roles: every Insights screen is **OWNER and ADMIN** (same as today's Reports/Revenue/Fleet/Growth/Dashboard pages,
which all call `requireRole("OWNER","ADMIN")`). STAFF never sees the tabs (NAVIGATION `restriction: "finance"`) and the
data functions refuse them.

**Numbers only from recorded data.** Every figure has an `InfoTip` with its exact definition (glossary keys below).
No goal, price or rule changes. No charts library: the only graphics are the existing bar style used on the revenue
page (`div` bars with `aria-hidden` plus a visually hidden table) — reuse it as kit `MiniBars` (section 5).

## 1. Fixes found while specifying (do them in this card)

- **Goal pace thresholds are hard-coded.** `PACE_QUIET_DAYS = 7` and `PACE_BEHIND_SHARE = 0.75` in
  `src/domains/goals/pace.ts` decide when a goal shows "Behind". Make them owner settings (BusinessSettings,
  additive, in this card's migration): `goalQuietDays Int @default(7)` (0–15; "Days at the start of a month before a
  goal can show as behind. Starting value 7, because the first week is too early to judge.") and
  `goalBehindPercent Int @default(75)` (50–100; "A goal shows Behind when you're below this share of where you'd
  expect to be by today. Starting value 75%."). `pace.ts` takes them as parameters; its tests pass the values. Catalog
  rows in AR-8's catalog, section Money.

- **Lead source report loads every lead.** `getLeadSourceBreakdown` (`src/domains/leads/index.ts:517`) runs
  `prisma.lead.findMany` with no limit and groups in memory, and has no role check. Replace its body with one
  `prisma.lead.groupBy({ by: ["howHeard", "status"], _count: true })` (trim/blank → "Not given" after grouping) and
  keep its return shape; the new insights code calls the grouped version.
- **No record of when a lead was won or lost.** `Lead` has no closed date, so "win rate this month" cannot be
  computed. Add `Lead.closedAt DateTime?` (additive migration `20261030000000_lead_closed_at`, index
  `@@index([status, closedAt])`), set it in the same transaction wherever a lead becomes CONVERTED or LOST
  (`updateLeadStatus`, the convert path at `src/domains/leads/index.ts` ~472 `lead.convert`, LD-1's merge which sets LOST),
  and clear it when a lead is reopened. Backfill in the migration from the newest `AuditLog` row with action
  `lead.status` or `lead.convert` for each closed lead (`UPDATE "Lead" l SET "closedAt" = a."createdAt" FROM (SELECT
  DISTINCT ON ("entityId") "entityId", "createdAt" FROM "AuditLog" WHERE action IN ('lead.status','lead.convert')
  ORDER BY "entityId", "createdAt" DESC) a WHERE a."entityId" = l.id AND l.status IN ('CONVERTED','LOST')`); leads
  with no audit row keep null and are left out of time-based win rates (the InfoTip says "Leads closed before October
  2026 may be missing").
- **Growth, earnings and fleet reads have no role checks of their own** (`src/domains/growth/index.ts`,
  `growth/demand.ts`, `reports/index.ts`, `dashboard/index.ts`); some are also used by To do rules and cron jobs where
  there is no session, so do **not** add `requireRole` inside them. The new `src/domains/insights/*` functions call
  `requireRole("OWNER","ADMIN")` first and then the existing reads (the #594 rule: data reads guard themselves).
- **Job-role access must not widen.** Job roles map a desk address to a screen by its first segment only
  (`PATH_TO_SCREEN` in `src/domains/team/job-role-rules.ts`): today `/desk/growth` belongs to `management` and
  `/desk/fleet`, `/desk/revenue`, `/desk/reports`, `/desk/dashboard` to `billing`. Moved under `customers` and
  `inventory`, the insights would follow those screens instead — an admin whose job role has Customers but not
  Management would newly see Growth figures. Add a two-segment map checked first in `screenForPath`:
  `{ "customers/insights": "management", "inventory/insights": "billing", "money/income": "billing" }` (longest
  match wins). Tests in `tests/acc5-job-role-rules.test.ts`: an ADMIN with Customers but not Management is refused on
  `/desk/customers/insights` and still opens `/desk/customers`; an ADMIN with Equipment but not Money is refused on
  `/desk/inventory/insights`. The Insights tab in `DESK_AREAS` is hidden by the same rule (`jobRoleAllowsPath`).
- **The Communications cost section sits on Reports** (`src/app/desk/reports/telecom-report.tsx`) although it is a
  phone-cost setting matter (AR-12 feature `phoneCosts`). Move `TelecomReportSection` unchanged to
  `/desk/settings/telecom` (SETTINGS.md 4.6), below the existing controls.

## 2. Routes and navigation

| New screen | Route | Area tab (AR-1 `DESK_AREAS`) | Old pages it replaces |
|---|---|---|---|
| Customers › Insights | `/desk/customers/insights` | new tab `insights` · "Insights" · finance, placed last; `matches: ["/desk/growth"]` (remove `/desk/growth` from the `customers` tab's matches) | `/desk/growth`, lead sources from `/desk/reports`, lead/customer counts from `/desk/dashboard` |
| Equipment › Insights | `/desk/inventory/insights` | new tab `insights` · "Insights" · finance, placed last; `matches: ["/desk/fleet"]` (remove `/desk/fleet` from `fleet`) | `/desk/fleet`, fleet flags and demand from Growth, "Repairs missing a logged cost" from Reports, appliance counts from Dashboard |
| Money › Overview additions | `/desk/money` (AR-3) | unchanged | earnings gaps from Reports, monthly-rent history and MRR/ARR from Revenue/Dashboard |
| Money › Income details | `/desk/money/income` | Overview tab (`matches` add `/desk/money/income`) | the ledger part of `/desk/revenue` |

Redirects (each old `page.tsx` becomes only a `redirect()`; keep the files until AR-10):
`/desk/growth` → `/desk/customers/insights`; `/desk/fleet` → `/desk/inventory/insights` (keep its `page` and `costs` params
unchanged); `/desk/revenue` → `/desk/money/income` (keep all query params);
`/desk/reports` → `/desk/money`; `/desk/dashboard` → `/desk/today`. `/desk/reports/export` (CSV route) stays and is
linked from the Money Overview ⋯ menu as "Download transactions (CSV)". Update AR-3's Overview ⋯ menu: "Income
details" (`/desk/money/income`) replaces "Rental income details" and "Reports". The AR-1 tab table test and the
redirect test list the new rows.

**Folder names:** `src/app/desk/customers/insights/page.tsx` must not collide with `customers/[id]`: a static segment
wins over a dynamic one in the App Router (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`);
add a test that `/desk/customers/insights` renders Insights, not a customer lookup. Same for
`src/app/desk/inventory/insights` vs `inventory/[id]`.

## 3. "Not enough data yet"

`src/domains/insights/thresholds.ts`: `MIN_LEADS = 10`, `MIN_RENTALS = 10` (the design's "check back after 10
rentals"). These are **display** thresholds that decide whether a percentage is meaningful, not business policy, so
they stay in code (say so in the PR). A block whose base count is below its threshold renders `EmptyState`
"Not enough data yet — check back after 10 {leads|rentals}" with the count so far ("You have 4 so far."). Counts and
money totals always show; only rates, medians and averages wait for the threshold.

## 4. Customers › Insights (`/desk/customers/insights`)

**Data** `src/domains/insights/customers.ts` (`requireRole("OWNER","ADMIN")`):
```ts
export async function getLeadInsights(now = new Date()): Promise<LeadInsights>      // LD-4
export async function getCustomerInsights(now = new Date()): Promise<CustomerInsights> // CU-3
export async function getWorthACall(now = new Date()): Promise<WorthACall>            // today's Growth lists
```
Months are Denver months (`businessMonthBounds(now)` and the previous month); weeks are Denver weeks starting Monday
(`businessWeekStart`).

**Lead insights** (this month and last month for each):
- `newLeads` — leads `createdAt` in the month (merged leads excluded: `mergedIntoLeadId: null`).
- `speedToLeadMedianMinutes` — median of `businessMinutesBetween(createdAt, firstContactedAt, hours)` over leads
  created in the month with `firstContactedAt` set and `firstContactEstimated = false`. `businessMinutesBetween` is new
  in `src/lib/business-hours.ts` (pure): counts only minutes inside the opening hours from Settings (`hours`, parsed
  with the existing `parseStoredHours` in `src/domains/settings/profile-extras.ts`) on Denver days that are not in
  `holidayClosures`; when no hours are set it counts all minutes and the InfoTip says "Counted around the clock — your
  opening hours aren't set." Unit tests: inside hours, overnight, weekend, holiday, DST start/end, no hours.
  Shown as "{n} min", "{h} h {m} min" or "{d} business days". Below the value: "Your target {leadResponseTargetMinutes}
  min" when LD-1's setting exists.
- `quoteRate` — of leads created in the month, the share with at least one estimate whose `sentAt` is set.
- `winRate` — of leads with `closedAt` in the month, the share CONVERTED (needs ≥ `MIN_LEADS` closed).
- `pipelineValueCents` — sum of monthly rent on open quotes for leads (estimate status SENT, VIEWED,
  CHANGES_REQUESTED or APPROVED and not converted; monthly = SUM of `EstimateLineItem` monthly lines, the same sum
  QUOTES-MESSAGES section 2 uses).
- `bySource` — grouped `howHeard` (from the fixed `getLeadSourceBreakdown`), with leads, won, win rate; top 8 then
  "Everything else".
- `topLostReasons` — `groupBy lostReason` over leads LOST with `closedAt` in the last 90 days, top 5; blank →
  "No reason given".
- `trend` — 12 Denver weeks: new leads and won leads per week.

**Customer insights:**
- `activeCustomers` now = distinct `customerId` with an ACTIVE agreement; at the start of the month = distinct
  customers with an agreement whose `startDate < monthStart` and (`closedAt` null or `closedAt ≥ monthStart`) and
  status not DRAFT/AWAITING_SIGNATURE/SCHEDULED; `change` = now − start.
- `newCustomers` — customers whose earliest agreement `startDate` is in the month.
- `lostCustomers` and `whyLost` — customers whose last agreement `closedAt` is in the month and who have no ACTIVE or
  SCHEDULED agreement now. "Why" is derived (there is no "why they left" field — see Gaps): CANCELLED with a
  `PreDeliveryCancellation` → "Cancelled before delivery"; an `EarlyReturnResolution` on that agreement → "Ended
  early"; ENDED with `closedAt` ≥ `endDate` → "Rental finished"; a written-off bill on the agreement → "Stopped paying";
  else "Ended". Counts per reason.
- `avgMonthlyRentCents` = `getRevenueDashboard(now).mrrCents` ÷ `activeCustomers` (integer cents, `Math.round`).
- `avgLifetimeMonths` — over customers with no ACTIVE/SCHEDULED agreement and at least one closed agreement: months
  from first `startDate` to last `closedAt` (`monthsSince` in `growth/signals.ts`), average, one decimal.
- `avgCollectedPerCustomerCents` — per customer, receipts minus refunds (the same tables and rules as
  `collectedBetween`, `src/domains/billing/collected.ts`, but grouped by `customerId` in two `groupBy` queries), averaged
  over customers who ever had an ACTIVE agreement.
- `autopayShare` — of customers with an ACTIVE agreement, the share where that agreement has `stripeSubscriptionId`.
- `payingLateShare` — of customers with an ACTIVE agreement, the share with a bill matching `pastDueInvoiceWhere(now)`
  (shared helper from AR-2/TODAY.md).
- `topCities` — active customers grouped by their agreements' service address `city`, top 5.

**Worth a call** = today's Growth lists, unchanged functions and wording, each capped at 10 with "Show all"
expanding to the function's own cap: `getChurnRiskCustomers` ("Customers worth a call"), `getWinBackLeads` ("Leads
worth a follow-up"), `getPriceReviewAgreements` ("Rentals due for a price review"), `getReviewRequestCandidates`
("Good people to ask for a review or referral"). Each row links to its record (customer, lead, rental) and keeps its
existing reason text. (Fleet flags and demand move to Equipment.)

**Layout** (phone first):
- `ScreenHeader` "Customers", `AreaTabs` (Insights current).
- Section "Leads" — `StatStrip` 2×2 phone / 4 desktop: "New leads" `{n}` with "Last month {n}"; "Speed to lead"
  `{median}`; "Quote rate" `{pct}`; "Win rate" `{pct}`. Under it "Pipeline value {formatMoney(pipeline)}/mo". Then
  "Where leads come from" `DataTable` (Source · Leads · Won · Win rate; phone cards), "Why leads were lost" list,
  "Last 12 weeks" `MiniBars` (new vs won, legend in words).
- Section "Customers" — `StatStrip`: "Active customers" `{n}` with "{+2} this month"; "New this month"; "Left this
  month" (tap → the why list); "Average rent" `{formatMoney}/mo`. Then a definition list: "Average time as a customer
  {x} months", "Collected per customer {money}", "On automatic payments {pct}", "Behind on a bill now {pct}", "Top
  cities" (chips).
- Section "Worth a call" — the four lists as `DataTable` cards with one primary action each: Call (`tel:` when a
  phone exists) for customers/leads, "Open rental" for price reviews, "Open customer" for review/referral candidates
  (the Growth page has no send action today; nothing is sent from here).
- Each section header has a `?period=` toggle "This month / Last month" (URL state, zod param `period` =
  `this` | `last`, default `this`).

## 5. Equipment › Insights (`/desk/inventory/insights`)

**Data** `src/domains/insights/equipment.ts` (`requireRole("OWNER","ADMIN")`): `getEquipmentInsights(params, now)`
returning `getFleetAnalytics(now)`, `getApplianceCountsByStatus()` and `fleetReportPage(appliances, page, costs ===
"missing")` (the current `/desk/fleet` page's reads, same `page`/`costs` params),
`getFleetUtilizationPercent(now)`, `listIdleAppliances(settings.idleApplianceAlertDays, now)`, `getUtilizationFlags(now)`,
`getDemandEstimate()`, `getJobsMissingRepairCost()` (appliance counts come from `getApplianceCountsByStatus()` — total, available, rented out).

**Layout:** `ScreenHeader` "Equipment", `AreaTabs` (Insights current).
- `StatStrip`: "Appliances" `{total}`; "Rented out" `{n}` with `{utilization}%`; "Available" `{n}`; "Idle {days}+ days"
  `{n}` (tap → list).
- "Value and cost" — the fleet page's top figures and its "How to read these numbers" text moved into `InfoTip`s (no
  paragraph), then "Most used", "Least used", "Highest repair costs" lists (each top 5, link to the appliance).
- "Flags" — `getUtilizationFlags` rows (existing wording).
- "What people are asking for" — `getDemandEstimate` rows (type · open requests · available · gap).
- "Repairs missing a cost" — `getJobsMissingRepairCost` rows → visit page; empty "Every finished repair has a cost."
- "All appliances: value and cost" — the fleet report table (`fleetReportPage`) as `DataTable` with its filter
  ("All units" / "Incomplete costs", param `costs=missing`) and `page` param unchanged.

## 6. Money › Overview additions (AR-3's `/desk/money`) and Income details

Add to `getMoneyOverview` a second read used only on this page, `getRentHealth(now)` in
`src/domains/insights/money.ts` (`requireRole("OWNER","ADMIN")`): `mrrCents`, `arrCents` (`getRevenueDashboard`),
the last 6 months of expected monthly rent (the revenue page's existing series), goal progress (`getGoalProgress(now)`),
and the earnings rows where the gap is ≥ $10.00 (`getEarningsReport()` filtered with the Reports page's existing
`NOTABLE_GAP_CENTS` — move that constant into `insights/money.ts`).
Overview sections (below AR-3's): "How rent is doing" — "Monthly rent from active rentals {mrr}" and "Over a year
{arr}", `MiniBars` for the 6 months; "Goals" — each goal as label · "{actual} of {target}" · pace word ("On pace",
"Behind", "Met", "Too early to tell") with a link "Change goals" → `/desk/settings/goals`; empty "No goals set" +
"Set a goal"; "Rentals paying less than agreed" — the earnings gap rows (customer · agreed · paying · gap), empty
"Nothing is behind right now."

**Income details** `/desk/money/income`: the current `/desk/revenue` ledger (`getRevenueRecords(source, monthOnly,
page, asOf)`) rebuilt as a KIT 5.1 work queue: `StatusTabs` "Money received" (`source=payments`, default) and
"Refunds" (`source=refunds`), filter "When" ("This month" = default, "All dates" = `scope=all`), `page` param kept (the function pages by number today;
keep it — no cursor change in this card). Words: "Money received", "Refunds", "This month", "All dates".

## 7. Glossary keys (add to `src/lib/glossary.ts`, kebab-case, `{ title, description }`)
`speed-to-lead`, `quote-rate`, `win-rate`, `pipeline-value`, `active-customers`, `customers-left`,
`average-rent`, `time-as-customer`, `collected-per-customer`, `automatic-payments-share`, `behind-on-a-bill`,
`fleet-utilization`, `idle-appliance`, `demand-gap`, `monthly-rent-now`, `goal-pace` — each description is the exact
definition in sections 4–6 in plain words (e.g. win rate: "Of the leads you closed this month, how many became
customers. Leads closed before October 2026 may be missing.").

## 8. Kit addition — `MiniBars`
`{ series: { label: string; values: number[] }[]; labels: string[]; format(v: number): string }` — vertical bars in
`bg-primary` / `bg-ink-soft` (max two series), height 120 px, value labels on tap/hover, plus a visually hidden
`<table>` with the same numbers (screen readers). No library.

## 9. Tests
- `tests/business-hours.test.ts` (cases in section 4).
- `tests/lead-insights-integration.test.ts` (throwaway Postgres, fixed fixtures): each lead metric; estimated first
  contacts excluded; merged leads excluded; numbers equal the Leads list filters for the same period (LD-4 test).
- `tests/customer-insights-integration.test.ts`: active now / at month start / change; lost and why categories; averages
  in integer cents; autopay and late shares; threshold empty states.
- `tests/lead-closed-at-integration.test.ts`: convert/lost set `closedAt`, reopen clears it; migration backfill SQL on
  a fixture.
- `tests/lead-source-breakdown.test.ts`: grouped query gives the same output as before on a fixture.
- `tests/insights-roles.test.ts`: STAFF refused by every `src/domains/insights` function; the redirects; the static
  `insights` segment wins over `[id]`.
- `e2e/ar9-insights.spec.ts` (shard): owner opens each Insights tab, sees numbers on the seeded data; staff has no
  Insights tab and a direct URL is refused; old URLs land on the new screens; axe + 5 sizes; keyboard through the
  period toggle and tables.
