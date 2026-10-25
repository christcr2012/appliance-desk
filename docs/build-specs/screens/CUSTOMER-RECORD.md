# Screen spec — Customer record (a "record page")

Route: **`/desk/customers/[id]` (same URL)**. Visual targets: `samples/CustomerPhone.dc.html`,
`samples/CustomerDesktop.dc.html`. Built in **AR-0** as the reference record page (KIT 5.2). Every later record page
(agreement, visit, appliance, lead, bill) copies this layout.

## 1. Who sees what (do not change)

- STAFF: keep `return <OperationalCustomer id={id} />` exactly as now. Nothing in this spec applies to staff.
- OWNER and ADMIN: everything below. Money numbers (owes, monthly rent, pays on time) are OWNER/ADMIN only, and so
  are notes (existing rule: "Internal notes remain visible only to owners and administrators").
- Not found → `notFound()` (unchanged).

## 2. URL parameters (`src/app/desk/customers/[id]/params.ts`, zod)

| Param | Values | Default |
|---|---|---|
| `tab` | `activity`, `rentals`, `bills`, `visits`, `messages`, `details` | none (see 4.3) |
| `full` | `1` — with `tab=activity`, show the full activity list in the desktop main column (4.4) | — |
| `filter` | activity filter: `all`, `notes`, `activity`, `communications` (existing `timelineFilter`) | `all` |
| `cursor` | activity cursor (existing `readTimelineCursor`) | — |
| `page` | rentals/visits page (existing `parsePage`, 25 per page) | 1 |
| `newAccount`, `emailSent` | existing one-time notice after creating an account | — |

**Old links keep working** (redirect inside the page with `redirect()`, keep other params):
`tab=overview` → no `tab`; `tab=properties` → `tab=details`; `tab=service` → `tab=visits`;
`tab=billing` → `tab=details#referrals`. Unknown values → no `tab`.

## 3. Data

Reuse, unchanged: `getCustomerIdentity`, `getCustomerOverview` (next visit, linked tasks), `getCustomerProperties`
(addresses, contacts), `getCustomerRentals`, `getCustomerService`, `getCustomerBillingContext`,
`getCustomerTimelinePage`, `getMessageHistory("Customer", id)`, `getNextBills(customerId)`
(`src/domains/portal/next-bill.ts` — it does no role check, so call it only after `requireRole("OWNER","ADMIN")`).

New read-only functions (one file, `src/domains/customers/record.ts`; each starts with
`await requireRole("OWNER", "ADMIN")`):

```ts
export type CustomerStatus = "active" | "upcoming" | "past" | "new" | "archived";
export type CustomerSummary = {
  status: CustomerStatus;
  customerSince: Date;               // Customer.createdAt
  city: string | null;               // first service address (createdAt asc) city
  primaryAddress: string | null;     // "{line1}, {city}" of that address
  monthlyRentCents: number;          // sum of rentForNextBill(lines) over ACTIVE agreements
  owedCents: number;                 // sum over open bills (billTabWhere("open")) of max(0, due − paid)
  oldestOpenBillId: string | null;   // open bill with the earliest dueDate (nulls last) — target of "Take payment"
  nextBill: { date: Date; rentCents: number } | null;  // earliest of getNextBills()
  autopay: boolean;                  // Customer.stripeDefaultPaymentMethodId != null
  renting: string | null;            // see rentingText below
  onTime: { paidOnTime: number; counted: number } | null;
  hasPortalLogin: boolean;           // the same condition the current page uses to show ResendActivationButton
};
export async function getCustomerSummary(customerId: string, now = new Date()): Promise<CustomerSummary>
export function customerStatus(input: { archivedAt: Date | null; agreementStatuses: RentalAgreementStatus[] }): CustomerStatus
export function rentingText(typeNames: string[]): string | null
export function onTimeRecord(bills: { dueDate: Date | null; paidAt: Date | null }[]): { paidOnTime: number; counted: number } | null
```

Rules (pure functions, unit-tested):
- **customerStatus** (first match wins): `archivedAt` set → `archived`; any `ACTIVE` → `active`; any `SCHEDULED` or
  `AWAITING_SIGNATURE` → `upcoming`; any `ENDED` → `past`; else `new`. Pill words and tones: active "Active" (good),
  upcoming "Starting soon" (info), past "Past customer" (neutral), new "New" (info), archived "Archived" (neutral).
- **rentingText**: the distinct appliance type names on ACTIVE agreements' line assignments, in first-seen order.
  0 → `null` (stat hidden); 1 → that name ("Washer"); 2 → "Washer + dryer" (first as written, second lower-cased);
  3 or more → "{n} appliances". Names come from `assignments.appliance.applianceType.name`; if a line has no
  assignment yet, use the line `label` up to the first " @ " (the label format is `"Washer/Dryer set @ $60/mo"`).
- **owedCents** uses `billTabWhere("open", now)` from `src/domains/billing/bill-status.ts` (built in the Bills screen,
  same card) filtered by `customerId`. Never re-write the open rule here.
- **onTimeRecord**: take this customer's last 7 bills (by `dueDate` desc) with status `PAID` or currently past due
  (`pastDueInvoiceWhere(now)`), skipping bills with no `dueDate`. For a PAID bill, `paidAt` = **the date of the last
  settlement event that brought it to fully paid**, considering both kinds of settlement:
  - Payments whose status is in `SUCCESSFUL_PAYMENT_STATUSES` (`src/domains/billing/payment-status.ts` — both
    `SUCCEEDED` and `succeeded`; never one spelling), dated by their Receipt's `receivedOn` when they have a receipt
    (the date money arrived — for a check recorded days later, the date Chris entered), otherwise `Payment.createdAt`;
  - `CreditApplication` rows for the bill (`applyCreditToInvoice` settles bills with account credit and creates no
    Payment), dated by `CreditApplication.createdAt`.
  Sort both lists by date and take the first date at which the running total of payments + credits reaches the
  bill's `amountDueCents`; if it never does (data inconsistent), skip the bill. Unpaid past-due → `paidAt = null`
  (late). On time when `paidAt` ≤ the end of its due day in Denver (`businessDayBounds(dueDate).end`). Return `null`
  when fewer than 3 bills counted (stat hidden).
- Select only the fields needed. One `Promise.all`; no per-row queries.

**Next steps for this customer (customer-scoped, so the business-wide cap never hides them).** Today's
`getExceptionOverview()` caps each category at 50 rows business-wide *inside its queries*
(`EXCEPTION_CATEGORY_CAP`), so filtering its result by customer would miss this customer's items when the business has
many. Instead build a scoped read that reuses the same item builders and the same snooze handling:

1. **Pure refactor (no behavior change):** in `src/domains/exceptions/index.ts`, move the tail of
   `getExceptionOverview()` — from `const ordered = sortExceptions(visibleItems)…` to the `return` — into
   `export async function markTodoItems(items: ExceptionItem[], now: Date, canViewFinance: boolean):
   Promise<{ items: ExceptionItem[]; snoozed: ExceptionItem[] }>` and call it from `getExceptionOverview()`. The
   existing To do tests must pass unchanged.
2. Add an optional last parameter `scope?: { customerId?: string }` to `listUnsignedAgreements`,
   `listSignedDeliveryAttention`, `listRentalEndingSoon`, `listPickupUnscheduled`, `listSigningPaymentAttention` and
   `listDepositDecisionAttention`. When `scope.customerId` is set, add `customerId` (or `agreement: { customerId }`,
   whichever the function's root model has) to the query's `where` **before** `take`. Existing calls pass nothing, so
   Today is unchanged.
3. `src/domains/customers/record.ts`:
   ```ts
   export async function getCustomerNextSteps(customerId: string, now = new Date()): Promise<ExceptionItem[]>
   ```
   `await requireRole("OWNER", "ADMIN")`, then in one `Promise.all`, each with `take: 3` and `customerId` in the
   `where`:
   - past-due bills: the same `where` and `select` the overview uses for `PAST_DUE_INVOICE`, plus `customerId`,
     built with `pastDueInvoiceException`;
   - overdue visits: the overview's `OVERDUE_JOB` query + `customerId`, built with `overdueJobException`;
   - unreviewed service requests: the overview's `UNREVIEWED_MAINTENANCE_REQUEST` query + `customerId`, built with
     `unreviewedMaintenanceRequestException`;
   - the six `list*` functions above with `3, now` (where they take `now`) and `{ customerId }`.
   Flatten, `markTodoItems(items, now, true)`, keep `.items` (not snoozed), `sortInbox` (TODAY.md 3), first 3.
4. Test `tests/customer-next-steps-integration.test.ts` (throwaway Postgres): create 55 past-due bills for other
   customers that are older than this customer's one → this customer still gets its past-due item; a snoozed item is
   not returned; customer B's items never appear for customer A.

The page renders each with the same `inboxActions(item)` as Today, so buttons are identical everywhere.

## 4. Layout

### 4.1 Header (`RecordHeader`, KIT 4.7)

- Back link (phone and desktop): "← Customers" → `/desk/customers` (keep any `?q=`/view the list sent in `from`
  param if present; otherwise plain).
- Title: `user.name ?? user.email`. Pill: customerStatus (4.1 words). Desktop also: when `owedCents > 0` a second
  pill `"Owes {formatMoney(owedCents)}"` (attention).
- Phone detail line: `"Customer since {formatMonthYear(customerSince)}" · {city}` (omit city when null). Desktop detail line:
  `{phone} · {email} · {primaryAddress} · customer since {formatMonthYear(customerSince)}` (omit missing parts; email `break-all`).
- **Phone quick actions** (three equal buttons with icon + word under the header): Call (`tel:` phone; disabled with
  InfoTip "No phone number saved" when missing), Email (`mailto:`), Map (Google Maps search URL of
  `primaryAddress`; hidden when none).
- **Desktop actions** (`ActionBar` in the header, right side, in this order):
  1. Primary: when `owedCents > 0` → **Take payment** (link
     `/desk/billing/customer/{id}/invoice/{oldestOpenBillId}#take-payment`); otherwise **New quote**
     (`/desk/estimates/new?customerId={id}`).
  2. Call (`tel:`), only when a phone exists.
  3. New quote (only when it is not already the primary).
  4. Schedule visit (`/desk/jobs/new?customerId={id}`).
  5. ⋯ menu: "New rental" (`/desk/agreements/new?customerId={id}`), "View statement"
     (`/desk/billing/customer/{id}`), "Add a note" (opens the note sheet, 4.6), "Resend account email" (renders the
     existing `ResendActivationButton` as a menu item; only when it is shown today), "Locations"
     (`/desk/customers/{id}/locations`).
- **Phone bottom ActionBar** (sticky above the bottom nav): "New quote" (secondary) and "Schedule visit" (primary).
  The ⋯ in the phone top bar holds the same menu as desktop item 5 plus "Take payment" when owing.
- The `newAccount=1` notice: one-line `toast` on load ("Account created. Activation email sent." or "Account
  created. The email didn't send — use Resend account email in the ⋯ menu.") instead of the boxed paragraph.

### 4.2 StatStrip (KIT 4.7)

Phone shows a 2×2 grid; desktop one row of 5.
| Stat | Value | Tone | Shown when |
|---|---|---|---|
| Monthly rent | `formatMoney(monthlyRentCents)` | neutral | `monthlyRentCents > 0` |
| Owes now | `formatMoney(owedCents)` | attention if > 0, else good ("$0.00") | always |
| Next bill | `"{formatShortDate(date)} · autopay on"` / `"· autopay off"` | neutral | `nextBill` |
| Renting | `renting` | neutral | `renting` |
| Pays on time (desktop only) | `"{paidOnTime} of last {counted}"` | good if ≥ 80 %, attention if < 50 %, else neutral | `onTime` |
InfoTips (add to `GLOSSARY`, shape `{ title, description }`): `"owes-now"` { "Owes now", "Bills that are sent and
not fully paid." }, `"pays-on-time"` { "Pays on time", "Bills paid by the end of their due day, out of the last few
bills." }.

### 4.3 Sections (tabs)

Tab strip (`StatusTabs` variant "underline", label "Customer sections"):
- Phone: **Activity**, Rentals `{n}`, Bills, Visits, Details. ("Messages" lives inside Activity on phone — the
  `communications` filter.)
- Desktop: Rentals `{n}`, Bills, Visits, Messages, Details. (Activity is always in the right column.)
- `{n}` = count of ACTIVE + SCHEDULED + AWAITING_SIGNATURE agreements; hide the number when 0.

**When no `tab` is in the URL** the page renders both defaults and lets CSS pick:
`<div className="lg:hidden">{activitySection}</div><div className="hidden lg:block">{rentalsSection}</div>` and the
tab strip marks Activity selected on phone and Rentals on desktop (two strips, `lg:hidden` / `hidden lg:flex`).
When a `tab` is present, both strips mark that tab; `tab=activity` on desktop shows the Rentals content in the main
column (activity is already in the rail) — i.e. desktop treats `activity` like no tab.

### 4.4 Desktop columns

`lg:` two columns: main `flex-1 min-w-0` = header, StatStrip, tab strip, section; right rail `w-[360px]` =
Next step card(s) then Activity (4.5 compact: 10 newest entries, "See all activity" →
`?tab=activity&full=1`; **exception to 4.3:** when `tab=activity` *and* `full=1`, desktop shows the full activity list
(with its filters and paging, which keep `full=1` in their links) in the main column instead of Rentals). Phone: one column;
Next step card(s) sit between the StatStrip and the tab strip.

### 4.5 Section contents

**Activity** — existing `getCustomerTimelinePage(id, filter, cursor)`. Top: "Add a note" button (opens the note
sheet). Filter chips (`StatusTabs` small): "All", "Notes", "Texts and calls", "Activity". List: `Timeline`
(KIT 4.10) — each entry: summary (link when `entry.href`), `"{formatShortDate(createdAt)} · {authorName ?? 'automatic'}"`, detail text.
Paging: "Older" / "Newest" buttons (existing cursor). Empty: "Nothing recorded yet".
Phone also shows the message history here: when `filter=communications`, render `MessageHistoryPanel` above the
timeline list.

**Rentals** — `getCustomerRentals(id, page)` extended to also select `startDate`, `endDate`, `termMonths`,
`nextBillingDate`, and `lines: { label, monthlyPriceCents, packageId, assignments: { appliance: { id, assetNumber,
applianceType: { name } } } }` (extend the select only; keep 25 per page). One card per agreement:
- Title: `describeRentalLine` of each line joined " + " (`src/domains/portal/line-display.ts`); then `" · {n} months"`
  when `termMonths`, else `" · month to month"`.
- Detail: `"{line1} · started {formatShortDate(startDate)}"` + (`endDate` ? `" · ends {formatShortDate(endDate)}"` : "").
- Pill: owner agreement words (new map `AGREEMENT_PILL` in `src/domains/customers/record.ts`; do **not** use the
  customer-facing `rentalAgreementStatusLabel`): DRAFT "Draft" (neutral), AWAITING_SIGNATURE "Waiting for signature"
  (info), SCHEDULED `"Starts {formatShortDate(startDate)}"` (info), ACTIVE "Active" (good), ENDED "Ended" (neutral), CANCELLED "Cancelled"
  (neutral).
- Appliance chips: one per assignment, `"{type name} {assetNumber}"`, each a link to `/desk/inventory/{appliance.id}`.
- Billing line (ACTIVE only). Also select `stripeSubscriptionId` and `billingBlockedReason` on the agreement. Rules
  (first match wins):
  1. `billingBlockedReason` set → attention line (no ⚙): "Monthly billing isn't running for this rental." + link
     button "See why" → `/desk/agreements/{id}`. (The To do item `BILLING_BLOCKED` explains the reason; never print the
     stored reason code.)
  2. `stripeSubscriptionId` set and `nextBillingDate` set → AutomationLine: autopay → `"Automatic: {rent} is billed
     and charged to the card on file on the {ordinal day of nextBillingDate} of each month."`; no autopay →
     `"Automatic: a {rent} bill is made on the {ordinal} of each month."` (say nothing about how it is paid).
  3. otherwise → neutral line "Monthly billing hasn't started yet." (no ⚙).
  Unit-test the three cases. Billing starts or is blocked by `startRecurringBillingForAgreement`
  (`src/domains/billing/checkout.ts`); this line only reports what is stored. (`ordinal` helper: 1st, 2nd, 3rd, 4th…; put it in
  `src/lib/business-date.ts`, unit-test 1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31).
- Card is a link to `/desk/agreements/{id}`. Pagination (existing component) at the end. Empty: `EmptyState`
  "No rentals yet" + action "New rental".

**Bills** — the Bills list (MONEY-BILLS.md) filtered to this customer: call `getBills({ status: "open", customerId
})` then, below, `getBills({ status: "paid", customerId })` limited to 10 — add an optional `customerId` to
`BillsParams` (one extra `where` field). Two groups: "Open" and "Recent paid". Same mobile cards and row actions as
the Bills screen. Footer link button "Full statement" → `/desk/billing/customer/{id}`. Empty: "No bills yet".

**Visits** — `getCustomerService(id, page)`: group "Open service requests" (cards: problem as title, pill from the
existing `maintenanceStatusLabel`, detail `"Opened {formatShortDate(openedAt)}"`, link `/desk/maintenance/{id}`; "Showing 10 of {n}" note
when more) then "Visits" (cards: `"{jobTypeLabel(type)} · {formatShortDate(scheduledAt)}"` (no date → "Not scheduled"), pill
`jobStatusLabel`, detail address, link `/desk/jobs/{id}`). Header button "Schedule visit". Empty: "No visits yet".

**Messages** (desktop tab) — existing `MessageHistoryPanel rows={messages}`. On phone it is reached through
Activity › "Texts and calls". Remove the panel from the bottom of the page (it now lives here).

**Details** (`id` anchors in brackets) — stacked `SectionCard`s, in this order, each reusing the existing panel:
Contact info (name, email, phone, company — read-only text; editing stays where it is today), Addresses
(`ServiceAddressesPanel`) [#addresses], People to contact (`ContactsPanel`) [#contacts], Tax exemptions (existing
`tax-exemptions-panel.tsx` if the current page renders it) [#tax], Referrals and credits (`BillingContext`)
[#referrals], Linked tasks (`LinkedTasksPanel` from `getCustomerOverview().tasks`) [#tasks], Account
(`ResendActivationButton` when shown today; archived notice) [#account]. Also move `RecordConnections` here (last).

### 4.6 Note sheet

`Sheet` (KIT 4.19) titled "Add a note", containing the existing `AddNoteForm
customerId={id}` unchanged. On success: close, toast "Note added", refresh (the form already revalidates; if it
does not, call `router.refresh()`).

### 4.7 Next step card (KIT 4.8)

For each item from `getCustomerNextSteps` (max 3): `NextStepCard` with eyebrow "Next step", title `item.title`
(existing To do title, e.g. "October rent is 5 days late — card declined"), actions from `inboxActions(item)` **without** the
"Snooze…" menu item (primary + Call/Email only). Reason: Today's `snoozeToDoAction` only accepts keys that are in
the business-wide overview, which is capped, so snoozing here could be refused. Snoozing stays on Today. None →
render nothing (no empty card).

## 5. Words (exact)

"← Customers", "Customer since {Month YYYY}" (e.g. "Customer since March 2026"), "Owes {amount}", stat labels "Monthly rent", "Owes now", "Next bill",
"Renting", "Pays on time", "autopay on", "autopay off", tabs "Activity", "Rentals", "Bills", "Visits", "Messages",
"Details", buttons "Take payment", "Call", "Email", "Map", "New quote", "Schedule visit", "New rental",
"View statement", "Add a note", "Resend account email", "Locations", "See all activity", "Full statement",
section titles "Open", "Recent paid", "Open service requests", "Visits", "Contact info", "Addresses",
"People to contact", "Tax exemptions", "Referrals and credits", "Linked tasks", "Account". Remove the old header
description, the "Billing and referrals" title and the "Notes, activity and communications" description.

## 6. Tests

- `tests/customer-record.test.ts` (pure): `customerStatus` table (every branch, archived wins), `rentingText`
  (0, 1, 2, 3+, label fallback), `onTimeRecord` (fewer than 3 → null; paid 23:59 Denver on due day = on time; 00:01
  next day = late; DST weeks; unpaid past-due counts as late; a bill settled by the current
  payment writer (`recordManualPayment`, lowercase `succeeded`) is found; a check received on the due date but
  recorded 4 days later counts as on time; a bill paid entirely with credit on time counts as on time; a bill paid
  half by an early payment and half by late credit counts as late), `AGREEMENT_PILL` covers every
  `RentalAgreementStatus` (exhaustive `Record`), `ordinal`.
- `tests/customer-params.test.ts`: zod defaults; legacy `tab=overview|properties|service|billing` redirects.
- `tests/customer-summary-integration.test.ts` (throwaway Postgres): owed equals the Bills screen's open total for
  that customer; monthly rent sums only ACTIVE agreements; next bill is the earliest; customer A's summary never
  includes customer B's bills or agreements.
- `e2e/customer-record.spec.ts`: owner opens a seeded customer — phone shows Activity first and the bottom bar;
  desktop shows Rentals + right rail; old `?tab=service` lands on Visits; staff still sees the operational view and
  no money; axe + 5 sizes; keyboard reaches Take payment first in the header.
