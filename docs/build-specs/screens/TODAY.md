# Screen spec — Today (the inbox)

Route: `/desk/today` (same URL). Visual target: `docs/build-specs/samples/TodayPhone.dc.html`.
Built in **AR-0** (reference screen) and completed in **AR-2**. Kit: KIT.md.

## 1. Who sees what (do not change)

Keep the exact role gating of the current `src/app/desk/today/page.tsx`:
- OWNER and ADMIN: the inbox (all To do items from `getExceptionOverview()`), the health strip, visits, shortcuts.
- STAFF: today's visits and their own due tasks only (whatever the current page shows staff — read every `role`
  check in the current file and keep it). No money numbers for staff.
- OWNER only: the setup card (from `getSetupChecklist`, which already refuses others).
Keep the `?screen=not-in-job-role` notice (one-line banner at top: "You don't have access to that screen.").

## 2. Data (server, in the page)

Reuse exactly what the current page loads (`getExceptionOverview`, `getTodaysJobs`, `getDueTaskSummary`,
`getSetupChecklist`, `getBudgetPlanning`, `getWorkspace`), plus one new read function:

```ts
// src/domains/dashboard/weekly-health.ts (new)
export type WeeklyHealth = { moneyInCents: number; outRenting: number; rentableTotal: number; overdueBills: number };
export async function getWeeklyHealth(now = new Date()): Promise<WeeklyHealth>
```
- `moneyInCents` = `collectedBetween(null, businessWeekStart(now), now).netCents` (`src/domains/billing/collected.ts`).
- `businessWeekStart(now)` = new helper in `src/lib/business-date.ts`: Monday 00:00 America/Denver of `now`'s week
  (unit-test across both DST changes).
- `outRenting` = appliances with status `RENTED` or `AWAITING_PICKUP`; `rentableTotal` = all appliances except
  `RETIRED` (use `getApplianceCountsByStatus()` from `src/domains/inventory`).
- `overdueBills` = count of bills matching **`pastDueInvoiceWhere(now)`** — one shared predicate, defined in
  `src/domains/billing/bill-status.ts` as exactly the Bills screen's **past-due** rule (MONEY-BILLS section 2: the open
  rule — status `OPEN, PARTIALLY_PAID, DELINQUENT, FAILED` with money still owed — and `dueDate` before the **start of
  today in Denver**, so a bill due today is not late yet). `billTabWhere("past-due")` calls it; `getRevenueDashboard`,
  Money overview and the customer record's on-time record use it too (replace their own `dueDate < now` checks). Test:
  an unpaid bill due today is not counted anywhere as late; due yesterday is counted everywhere.
- Only called for OWNER/ADMIN.

**Contact on To do items (needed for the Call button).** Add an optional field to `ExceptionItem` in
`src/domains/exceptions/rules.ts`: `contact?: { phone?: string; email?: string }`. In
`src/domains/exceptions/index.ts`, wherever items of these categories are built, fill it from the related customer
(`Customer.phone`, `User.email`) or lead (`Lead.phone`, `Lead.email`): `PAST_DUE_INVOICE`, `NEW_LEAD_CONTACT`,
`LEAD_FOLLOW_UP`, `APPROVED_QUOTE`, `UNSIGNED_AGREEMENT`, `SIGNING_PAYMENT_DUE`, `SIGNED_DELIVERY_UNSCHEDULED`,
`RENTAL_ENDING_SOON`, `PICKUP_UNSCHEDULED`, `CANCELLATION_REFUND_DUE`, `DEPOSIT_DECISION`. Add the fields to the
existing `select`s only; do not add queries. Unit-test that at least `PAST_DUE_INVOICE` and `NEW_LEAD_CONTACT` carry it.

## 3. Grouping (new pure module `src/domains/exceptions/inbox.ts`)

```ts
export type InboxGroup = "money" | "sales" | "rentals" | "equipment" | "taxes" | "tasks" | "system";
export const INBOX_GROUP: Record<ExceptionCategory, InboxGroup> = { … }   // exhaustive: TypeScript enforces every category
export const INBOX_GROUP_LABEL: Record<InboxGroup, string> =
  { money: "Money", sales: "Sales", rentals: "Rentals & visits", equipment: "Equipment", taxes: "Taxes & books",
    tasks: "Tasks", system: "System" };
export function sortInbox(items: ExceptionItem[]): ExceptionItem[]   // high first, then dueOn asc (undefined last), then since asc
export function inboxEyebrow(item: ExceptionItem, now: Date): string
export function inboxActions(item: ExceptionItem): { actions: ActionSpec[]; overflow: MenuItem[] }
```

Group map (every category must appear exactly once):
- **money:** PAST_DUE_INVOICE, HELD_PAYMENT_DECISION, DEPOSIT_DECISION, CANCELLATION_REFUND_DUE, SIGNING_PAYMENT_DUE,
  BILLING_BLOCKED, SUBSCRIPTION_UPDATE_PENDING, APPROVAL_REQUEST
- **sales:** NEW_LEAD_CONTACT, LEAD_FOLLOW_UP, APPROVED_QUOTE, UNSIGNED_AGREEMENT, STALE_RESERVATION, GOAL_BEHIND
- **rentals:** SIGNED_DELIVERY_UNSCHEDULED, RENTAL_ENDING_SOON, PICKUP_UNSCHEDULED, VISIT_NEEDS_ASSIGNMENT, OVERDUE_JOB,
  UNREVIEWED_MAINTENANCE_REQUEST, AGREEMENT_TERM_EXPIRED, RENEWAL_NOT_STARTED, EARLY_ENDING_NOT_DONE,
  ITEM_NOT_DELIVERED, RETURNED_EARLY, NOTICE_WAITING, NOTICE_MISSED, NOTICE_UNCERTAIN, NOTICE_FAILED
- **equipment:** CLEANING_NEEDED, UNINSPECTED_RETURN, MISSING_REPAIR_COST, APPLIANCE_MAINTENANCE_DUE, OLD_SET_APPLIANCE,
  OUT_OF_SERVICE, CUSTODY_UNKNOWN, IDLE_APPLIANCES, LOW_UTILIZATION, RETIRED_APPLIANCE_PLAN, RETIRED_SALE_TAX_REVIEW
- **taxes:** SALES_TAX, TAX_RETURN_DUE, TAX_LICENSE_RENEWAL, TAX_SETUP_CHECK, TAX_AMENDMENT_DUE, TAX_FILING_NOT_READY,
  ACQUISITION_TAX_REVIEW, PURCHASE_USE_TAX_DUE, RETAIL_DELIVERY_FEE, BUSINESS_PAPERWORK
- **system:** SYSTEM_ISSUE
- **tasks:** (staff tasks from `getDueTaskSummary`, not an ExceptionCategory — rendered as items of this group)
If a category exists in code that is not in this list (added later), the TypeScript `Record` makes the build fail:
add it to the closest group and note it in the PR.

**Eyebrow:** `"{Urgent · }{group label}{ · deadline}"` — "Urgent · " only when `severity === "high"`; deadline =
`todoDeadlineLabel(item.dueOn, now, item.dueDateOnly)` when present (existing helper). Eyebrow tone: high →
`attention`; sales → `info`; others `neutral`.

**Actions:**
1. If `item.action` is set (tax source acknowledgment, apply/undo official rate): primary = a `form` ActionSpec that
   posts to the matching existing server action on this page (`acknowledgeTaxSourceAction`, `applyOfficialRateAction`,
   `undoOfficialRateAction`) with the same hidden fields as today; label = `item.action.label`.
2. Otherwise primary = `todoAction(item)` (existing: `{label, href}`) as a `link`.
3. Secondary = "Call" (`tel`) when `item.contact?.phone`; else "Email" (`mailto`) when `item.contact?.email`.
4. Overflow: "Snooze…" (opens the snooze sheet, section 5) when `item.todoKey` exists; "Open" (link to `item.href`)
   when the primary is a form; "View source" when `item.sourceHref` (HTTPS only, existing rule).

## 4. Layout

**Phone (target sample):**
1. Header: date line (`formatWeekdayDate(now)`, e.g. "Sunday, Oct 25") + title "Today"; right: search
   button (opens CommandBar after AR-1; before AR-1 links to `/desk/search`) and the profile button (initials).
2. Health strip (OWNER/ADMIN): one card, three columns — "Money in" `formatMoney(moneyInCents)` (dot good when >0,
   else neutral) · "Out renting" `"{outRenting} of {rentableTotal}"` (dot neutral) · "Overdue" `"{n} bills"` / "None"
   (dot attention when >0, else good). Each label has an InfoTip. Add three entries to `GLOSSARY` in `src/lib/glossary.ts`
   (existing shape `{ title, description }`, kebab-case keys): `"week-money-in"` { "Money in", "Payments received
   since Monday, after refunds." }, `"out-renting"` { "Out renting", "Appliances with a customer now, out of all the
   appliances you can rent." }, `"overdue-bills"` { "Overdue", "Bills past their due date that are not fully paid." }.
3. Setup card (owner, until complete): "Set up your business · {done} of {total} done" + "Continue" link (first
   undone step's href from the checklist).
4. Group chips (`StatusTabs`, param `group`): "All {n}" then each group with ≥1 item, in the order money, sales,
   rentals, equipment, taxes, tasks, system.
5. The list: `InboxCard` per item (sorted with `sortInbox`), max 50 per group (existing cap; show the existing
   truncation note as one line "Showing 50 of {total}" at the end of that group).
6. Visits (always, all roles): a section titled "Today's visits" with one `InboxCard` per visit:
   eyebrow "Visit · {time window}", title `"{Job type label} — {customer name}"`, detail = address; actions
   "Open visit" (link `/desk/jobs/{id}`) and "Directions" (maps link). Empty: "No visits today".
7. "Snoozed ({n})" link at the end when snoozed items exist → `?group=snoozed` shows them with a "Bring back"
   `form` action (existing `resumeToDoAction`, field `key`).
8. Bottom bar (existing until AR-1 replaces it).

**Desktop (`lg:`):** two columns inside the content area: left `max-w-[760px] flex-1` = header, setup card, group
chips (segmented style), inbox list; right `w-[340px]` = health strip (stacked), "Today's visits", "Shortcuts"
(O-7 pins as small buttons). Snoozed link at the bottom of the left column.

**Empty inbox:** `EmptyState` "You're all caught up" (no action).

## 5. Snooze sheet

Bottom sheet (phone) / dialog (desktop) titled "Snooze this item": date picker "Until" (min tomorrow, max 90 days,
default 3 business days from today via `addBusinessDays`), reason select: "Waiting on the customer", "Waiting on a
part", "Handled outside the app", "Other" (free text shown only for Other, max 200). Submit "Snooze" → existing
`snoozeToDoAction` (defined inside `src/app/desk/today/page.tsx`; keep it there and pass it to the client sheet as
a prop; it throws on bad input rather than returning a result) (fields `key`, `until` as `YYYY-MM-DD`, `reason`). Optimistic: remove the card immediately; on
error put it back and toast the error. Success toast "Snoozed until {date}" with Undo (calls `resumeToDoAction`).
Respect `validateSnoozeInput` messages.

## 6. Words (exact)

Title "Today". Health labels "Money in", "Out renting", "Overdue". Empty "You're all caught up". Visits heading
"Today's visits", empty "No visits today". Snoozed link "Snoozed ({n})". Snooze sheet strings as in section 5.
Keep every existing To do title/detail string (they already pass the plain-words check).

## 7. Tests

- `tests/today-inbox.test.ts`: every category maps to a group (compile-time + a runtime count equal to the union
  length); `sortInbox` order table; `inboxEyebrow` cases (high + deadline, sales tone); `inboxActions` (form action,
  contact → Call, email fallback, snooze present only with todoKey).
- `tests/weekly-health-integration.test.ts` (throwaway Postgres): week boundary Monday 00:00 Denver incl. DST weeks;
  overdue rule equals `getRevenueDashboard().pastDueInvoiceCount`.
- `tests/exceptions-contact.test.ts`: contact present on PAST_DUE_INVOICE and NEW_LEAD_CONTACT items.
- `e2e/today.spec.ts` (add to a shard): owner sees health + inbox + visits; staff sees no money; snooze then undo;
  sizes 360/390/820/1280/1920 with axe; keyboard: Tab reaches every card's primary action in order.
