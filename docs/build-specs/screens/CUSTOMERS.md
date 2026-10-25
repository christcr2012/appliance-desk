# Screen + engine spec — Customers list as a working tool (CU-1 + AR-4c)

Design: `docs/designs/CUSTOMERS-WORKSPACE.md` section 4 — **this spec changes one design choice** (section 1). The
customer record page is `CUSTOMER-RECORD.md` (AR-0). Roles: the list is OWNER/ADMIN/STAFF today (staff see customer
names and contact details for their work); money columns are OWNER/ADMIN only and are removed in the query for
staff.

## 1. Design change: no stored `CustomerSummary` table

The design proposed a `CustomerSummary` table kept up to date in the same transaction as every money, rental and
visit change, plus a nightly repair. That means touching dozens of write paths, and any one missed write makes the
list silently wrong. Decision: compute the same facts **live, in one SQL view**, and prove speed with the capacity
test. Only if the capacity test fails the 150 ms budget at 20,000 customers does a follow-up add a cache — and that
follow-up must be written up first (STATUS + card), not improvised.

## 2. Data (additive migration `20261026040000_customer_list`)

- `Customer.phoneDigits String?` + `@@index([phoneDigits])`, maintained by the same `contactKeys()` helper pattern as
  leads (`src/domains/customers/keys.ts`; every `customer.create/update` that sets `phone` also sets it — grep and
  test like LD-1). Backfill in SQL: `UPDATE "Customer" SET "phoneDigits" = NULLIF(regexp_replace("phone", '\D', '',
  'g'), '')`.
- `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (no-op if LD-1 ran first) and trigram GIN indexes on `User.name`,
  `User.email` (lower), `Customer.companyName`, `ServiceAddress.line1`, `ServiceAddress.city`, declared in the schema
  with `ops: raw("gin_trgm_ops")` like LD-1.
- Plain btree indexes if missing (check `schema.prisma` first): `RentalAgreement(customerId, status)`,
  `Invoice(customerId, status, dueDate)`, `Job(customerId, status, scheduledAt)`.
- **View** `customer_list_v1` (raw SQL `CREATE OR REPLACE VIEW` in the migration; read with `prisma.$queryRaw`, no
  Prisma model). One row per customer with `archivedAt IS NULL AND NOT "isWalkIn"`, built with one LATERAL subquery
  per group of facts. Columns:
  | Column | Definition |
  |---|---|
  | `id` | `Customer.id` |
  | `activeCount` | count of RentalAgreement with status ACTIVE |
  | `pendingCount` | count with status DRAFT, AWAITING_SIGNATURE or SCHEDULED, plus ACTIVE with `firstDeliveredOn IS NULL` |
  | `endedCount` | count with status ENDED |
  | `monthlyRentCents` | SUM of `RentalLine.monthlyPriceCents` over ACTIVE agreements (0 when none) |
  | `owedCents` | SUM of `GREATEST(0, "amountDueCents" - "amountPaidCents")` over invoices with status OPEN, PARTIALLY_PAID, DELINQUENT or FAILED (the `billTabWhere("open")` rule; a test runs both on one fixture and compares) |
  | `oldestOpenDueDate` | MIN(`dueDate`) over those same invoices |
  | `nextVisitAt` | MIN(`Job.scheduledAt`) with status SCHEDULED or IN_PROGRESS and `scheduledAt >= now()` |
  | `nextVisitType` | that job's `type` |
  | `nextBillOn` | MIN(`nextBillingDate`) over ACTIVE agreements |
  | `endingOn` | MIN(`endDate`) over ACTIVE agreements with `termMonths IS NOT NULL` and `terminationRequestedAt IS NULL` |
  | `pickupAt` | MIN(`Job.scheduledAt`) with `type = 'REMOVAL'` and status SCHEDULED |
  | `autopay` | `"stripeDefaultPaymentMethodId" IS NOT NULL` |
  | `propertyCount` | count of ServiceAddress |
  | `city` | `city` of the oldest ServiceAddress (by `createdAt`, then `id`) |
  Views cannot take parameters, so anything that depends on "today" is computed in the reading query, not the view:
  "past due" = `oldestOpenDueDate < $startOfTodayDenver`, and `pastDueCents` = a LATERAL SUM in the reading query over
  open invoices with `dueDate < $startOfTodayDenver`. Check every column and enum name against `schema.prisma` while
  writing the SQL (Job.type: DELIVERY, INSTALLATION, SWAP, MAINTENANCE_VISIT, REMOVAL).

## 3. Segments (pure, `src/domains/customers/segments.ts`)

```ts
export type CustomerSegment = "setting-up" | "active" | "owes" | "ending" | "past" | "new";
export function customerSegments(row: CustomerListRow, now: Date, endingDays: number): CustomerSegment[]
```
A customer can be in several. Rules (design section 4): setting-up = `pendingCount > 0 && activeCount === 0`;
active = `activeCount > 0`; owes = `oldestOpenDueDate` before start of today (Denver) — i.e. something past due;
ending = `endingOn` within `endingDays` (`getRentalEndingNoticeDays()`) or `pickupAt` within the same window;
past = no active or pending and `endedCount > 0`; new = none of the above. The database filter for each tab uses the
same conditions (`segmentWhereSql(segment)` returning a `Prisma.Sql` fragment) — integration test: for 30 fixture
customers, the tab query returns exactly those whose `customerSegments` includes it.

## 4. List query (`src/domains/customers/list.ts`)

```ts
export async function getCustomerList(p: CustomerListParams, now = new Date()): Promise<{ rows: CustomerListRow[]; nextCursor: string | null; capped: boolean }>
export async function getCustomerSegmentCounts(p: Omit<CustomerListParams, "segment" | "sort" | "cursor">, now = new Date()): Promise<Record<CustomerSegment, number>>
```
- `requireRole("OWNER","ADMIN","STAFF")`; for STAFF the SELECT omits `monthlyRentCents`, `owedCents`,
  `pastDueCents`, `autopay` (two SQL selects; the row type has them optional and the page never renders money for
  staff) and the `owes` segment and money sorts are rejected (fall back to the default).
- Params: `segment` (default `active`; `all` via the views menu), `q` (≥ 2 chars: digits ≥ 4 → `phoneDigits LIKE`;
  else name/email/company/address line/city `ILIKE '%q%'`; also an exact appliance `assetNumber` on a current
  assignment), filters `city` (multi), `pm` (property managers), `autopay` (`off`), `service` (has an open service
  request), `appliance` (appliance type ids on current assignments), `since` (customer-since date presets); `sort` =
  `attention` (default: past due first, then ending soon, then setting up, then name) | `name` | `rent-desc` |
  `owed-desc` | `newest` | `since`; `cursor` per KIT 5.1 using the sort key + id.
- **Next event text** (pure `nextEventText(row, now)`): the soonest of: visit → `"Visit {weekday short} {time
  window}"` (use the job's type label: "Delivery Tue 9–11"); bill → `"Bill due {formatShortDate}"`; ending → `"Ends
  {formatShortDate}"`; pickup → `"Pickup {formatShortDate}"`; none → "—".
- Fix the walk-in count bug for good: counts come from the same view/where as the list (PR #594 already excluded the
  walk-in from `getCustomersCount`; the new counts replace it).
- `getCustomers()` (export) gets `requireRole("OWNER","ADMIN")` (its only callers are the OWNER/ADMIN export route and
  tests); the CSV export moves to the new list query with the current filters (route `/desk/customers/export`
  accepts the same params; max 10,000 rows).
- Capacity test `tests/perf/customers-list.perf.test.ts` (Performance Baselines job): 20,000 customers, 60,000
  service addresses, 30,000 agreements, 120,000 invoices, 40,000 jobs; list (each sort), counts and search each under
  150 ms in CI; output the timings.

## 5. Screen — `/desk/customers` (same URL)

KIT 5.1 work queue. **Old links:** `?page=` ignored.
- `ScreenHeader` "Customers" (area title); ⋯: "Export (CSV)" (current filters).
- `StatusTabs` "Customer group": "Active {n}", "Owes money {n}" (OWNER/ADMIN), "Ending soon {n}", "Setting up {n}",
  "Past", "New" (hide 0 except Active), and "All" in the views menu.
- Toolbar: search "Name, phone, email, address or appliance number"; filters City, Property managers (toggle),
  Autopay off (toggle, OWNER/ADMIN), Has an open repair (toggle), Appliance type (multi), Customer since (presets);
  sorts "Needs attention", "Name A–Z", "Highest rent", "Owes the most" (OWNER/ADMIN), "Newest", "Customer since";
  built-in views (AR-12 `customers`).
- Card/row: name (company or "Property manager · {propertyCount} properties" under it) · city · segment pill(s)
  (first: owes → "Owes {formatMoney(pastDue)}" attention; else ending "Ending soon" info; setting-up "Setting up"
  info; active "Active" good; past "Past customer" neutral; new "New" info) · monthly rent and "Autopay on/off"
  (OWNER/ADMIN) · next event text · actions: **Call** (`tel:`), ⋯: "Take payment" (OWNER/ADMIN, owes; opens the
  payment Sheet for the oldest open bill per `payPathFor`), "Schedule a visit" (`/desk/jobs/new?customerId=`), "New
  quote" (OWNER/ADMIN, `/desk/estimates/new?customerId=`), "Open".
- Desktop columns: Customer · City · Status · Monthly rent · Owes · Autopay · Next · ⋯ (money columns hidden for
  staff); row click opens the `SidePanel` with the customer record's header, StatStrip and next step + "Open full
  page". No bulk money actions; bulk "Export selected (CSV)".
- Fab "New customer" → `/desk/customers/new` (OWNER/ADMIN; staff: none).
- Empty: active "No active customers yet" + "New customer"; filtered "No customers match" + "Clear filters".

## 6. Words (exact)
"Customers", "Active", "Owes money", "Ending soon", "Setting up", "Past", "New", "All", "Name, phone, email, address
or appliance number", "City", "Property managers", "Autopay off", "Has an open repair", "Appliance type", "Customer
since", "Needs attention", "Name A–Z", "Highest rent", "Owes the most", "Newest", "Owes {amount}", "Past customer",
"Autopay on", "Autopay off", "Property manager · {n} properties", "New customer", "No active customers yet", "No
customers match", "Export (CSV)", next-event texts above.

## 7. Tests
`tests/customer-segments.test.ts` (rule table, multi-segment), `tests/customer-list-integration.test.ts` (each tab =
rule; owed equals Bills open total per customer; staff rows have no money fields at runtime; search by phone digits,
address, asset number; cursor once-each; walk-in never appears or counts), `tests/customer-keys.test.ts`,
`tests/perf/customers-list.perf.test.ts`, `e2e/customers-list.spec.ts` (tabs, search, side panel, staff sees no
money and no Owes tab, export downloads the filtered rows), axe + 5 sizes.
