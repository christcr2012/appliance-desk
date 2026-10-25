# Appliance Desk as an application — app-wide redesign (Batch AR)

Status: **designed 2026-10-25 at Chris's request; not built.** Units AR-0…AR-10 are in `work-index.json`; execution
cards are written when each one starts. This is the **master design for every desk screen**. It absorbs the screen
parts of [BOOKS-AUTOPILOT.md](BOOKS-AUTOPILOT.md) (BA-4, BA-5, BA-6), [LEADS-WORKSPACE.md](LEADS-WORKSPACE.md) (LD-2, LD-3)
and [CUSTOMERS-WORKSPACE.md](CUSTOMERS-WORKSPACE.md) (CU-2, CU-3); their engine and data units (BA-1…BA-3, LD-1, LD-4,
CU-1) stay as written and feed these screens. The customer portal and public website are out of scope here (V batch).
No business rule, price, permission or money behavior changes: this is structure, workflow and presentation.

## 1. The problem (Chris, 2026-10-25)

> "Looks like a page to list functions… does not look like a system built into software. No workflow… In fact, that
> is my opinion on every page. This isn't put together like a software system… it is just pages set up as categories
> with related functions placed on them… This is a web app… the app part is short for application… There is no reason
> my system can't look, feel, and operate like the high-end software solution I envisioned."

Target he set earlier: **a first-time owner can run a brand-new company easily**, and it must keep working if the
company grows a lot.

## 2. Diagnosis (checked against `main`, 2026-10-25)

- **119 desk pages**, organized by category ("Money", "Taxes", "Books", "Settings", "More") rather than by the work
  being done. The menu has 5 groups plus a "More" page of 10+ entries.
- **Money is split across seven places:** `/desk/billing`, `/desk/books/*` (7 pages), `/desk/expenses`,
  `/desk/sales`, `/desk/sales-tax/*` (15 pages), `/desk/revenue`, `/desk/reports`.
- **Billing** (`src/app/desk/billing/page.tsx`): a sentence of explanation, then **seven filter chips that are really
  different things** — "All invoices", "Delinquent only", "By customer (statements)", "Deposits", "Waiting for
  Stripe", "Held payments" (a different page), "Reconciliation" (a different page) — a second paragraph, then a table.
  Problems that need a decision (held payments, failed charges) sit behind a chip instead of coming to the owner.
- **Seven overview pages compete:** Today, Dashboard, Control center ("Manage my business"), Reports, Revenue, Fleet,
  Growth.
- **Settings** is one long page plus 16 sub-pages, reached by links.
- **Workflows cross pages without a hand-off:** lead → quote → agreement → signing → delivery → billing → service →
  ending → pickup → deposit. Each step lives on its own page; nothing tells the owner "here's the next step" except
  some Today items.
- Many screens explain themselves in paragraphs; layout and components vary page to page (some `DataList`, some raw
  tables, some forms stacked on one page).

The engine underneath is strong (state machines, money rules, To do rules, audit). The gap is the **application
layer**: navigation, record pages, work queues, guided flows and one consistent kit.

## 3. What proven products do (references)

- **Jobber** (field service): the work is one lifecycle — *request → quote → job → invoice* — and finishing a job
  creates the invoice; a home dashboard shows where every appointment stands and what to do next; client history
  lives in one place. ([Jobber field service management](https://www.getjobber.com/features/field-service-management/),
  [converting a request to a quote or job](https://help.getjobber.com/en/articles/converting-a-request-to-a-quote-or-job/))
- **Stripe Dashboard** (billing): one Invoices list filtered by **status tabs and chips**, configurable columns,
  export, an overflow (⋯) menu per row, and a **detail page whose actions depend on the status**; badges such as
  "Past due" show an explanatory tooltip on hover.
  ([Stripe — manage invoices](https://docs.stripe.com/invoicing/dashboard/manage-invoices))
- Common to modern business apps (Linear, Stripe, Shopify admin, HubSpot): a small fixed set of top-level areas,
  every object has one **record page**, lists open records in a **side panel** on desktop, a **command/search bar** to
  jump anywhere, an **inbox** of things needing a person, and **wizards** only for multi-step creation.

Appliance Desk adopts these patterns; it does not copy any product's look (Evergreen brand stays, V batch).

## 4. The new structure

### 4.1 Five areas (same on phone bottom bar and desktop sidebar)

| Area | What it is | Absorbs today's |
|---|---|---|
| **Today** | Your inbox: everything that needs a person, in priority order, with inline actions; plus today's visits | Today, Tasks, Dashboard, Control center, Approvals, Notices |
| **Customers** | Leads · Customers · Quotes · Rentals · Messages (tabs) | Leads, Customers, Estimates, Agreements, Communications, Phone orders |
| **Schedule** | Day/week board, visits, routes, repairs | Dispatch, Jobs, Driver, Maintenance |
| **Equipment** | Fleet · Purchases · Parts · Retired (tabs) | Inventory, Fleet, Purchases, Purchase orders, Parts, Suppliers, Retired |
| **Money** | Overview · Invoices · Payments · Expenses · Books · Taxes (tabs) | Billing, Sales, Revenue, Reports, Expenses, Books/*, Sales tax/* |

**Settings** and **your account** move to a profile menu (avatar, top right on desktop; top of Today on phone).
**Insights** are a tab inside each area (Customers → Insights, Equipment → Insights, Money → Overview), not separate
pages. **"More" disappears**: every former More entry has a home above or in Settings. Every old URL keeps working
(redirect to its new home, or the same page now shown inside its area's tabs).

### 4.2 Four page types — every screen is one of these

1. **Work queue (list)** — a list of one kind of record.
   Header: area tabs → title + live count + primary button (e.g. "New invoice") + ⋯ (export, columns).
   Toolbar: status tabs with counts · search-as-you-type · **Filter** (one sheet) · **Sort** · **Saved views**.
   Active filters appear as removable chips. Rows show the few facts that drive a decision, a status pill (tooltip on
   hover/tap), the **next step with timing**, and a row ⋯ menu with the most common actions. Desktop: sortable columns,
   column chooser, multi-select bulk actions, row click opens the **record in a side panel**; phone: cards, tap opens
   full screen, swipe for the top two actions. Cursor paging ("Load more"), skeleton loading.
2. **Record page** — one customer, lead, rental, invoice, appliance, visit, purchase, expense.
   **Record header** (name, status, 3–6 key numbers as a stat strip) · **action bar** (one primary action that fits the
   status, ⋯ for the rest — like Stripe's status-dependent actions) · **next-step card** when something is due ·
   tabs (Overview, Activity timeline, then record-specific tabs) · related records as compact lists linking to their
   own record pages.
3. **Guided flow (wizard)** — only for multi-step creation or decisions: new rental (exists as `rental-wizard`), new
   customer/lead, phone order, purchase intake, month-end review (BA-3), books setup (BA-2), ending a rental
   (early return / ending decision / cancel / refund). Stepper at top, one decision per step, back/next, a review step,
   then it **hands off to the next workflow step** ("Rental signed → schedule delivery now?").
4. **Settings page** — one page, left section list (Business, Prices & packages, Rentals & policies, Team & access,
   Messages & phone, Money & taxes, Website, Advanced), a search box, and setting **rows**: label · current value ·
   ⓘ · edit inline or in a small panel · "changed by X on date" with history (O-1). No paragraphs.

### 4.3 Global pieces

- **Command bar** (`⌘K` / `Ctrl K` on desktop, search button on phone): find any customer, lead, rental, invoice,
  appliance (by asset number or serial), visit; jump to any area/setting; run common actions ("New quote", "Record a
  payment", "Add expense"). Results respect roles on the server (existing search domain).
- **Inbox rules (Today):** every existing To do category (`src/domains/exceptions/rules.ts`) becomes an inbox item
  with **inline actions** (Call, Take payment, Approve/Decline, Schedule, Snooze) and grouping by workflow (Sales,
  Rentals & visits, Money, Equipment, Taxes & books, Setup). The setup checklist for a new business lives at the top
  of Today until complete. Mandatory items cannot be hidden (O-7 rule kept).
- **Hand-offs:** every action that finishes a workflow step offers the next one in a toast or the next-step card
  (quote accepted → "Send for signature"; signed → "Schedule delivery"; delivery done → billing starts automatically
  (existing rule) and the toast says so; rental ending → "Schedule pickup"; pickup done → "Settle deposit").
- **Notifications** (in-app bell): new lead, quote viewed, signature done, payment failed, approval requested; each
  opens the record. (Email/text delivery of these follows existing switches; nothing goes live automatically.)
- **Quiet screens and no bare link lists** (DESIGN-SYSTEM rules from 2026-10-25) apply everywhere; enforced by guards.

## 5. The application kit (shared components — AR-0)

Build or upgrade in `src/components/ui`, documented in DESIGN-SYSTEM, each with axe/keyboard/phone tests:

`AppShell` (5 areas, profile menu) · `AreaTabs` (with counts, from `desk-sections.ts`) · `PageHeader` v2 (title, count,
primary, ⋯; **no description prop**) · `Toolbar` (status tabs, search, Filter sheet, Sort, Saved views, active chips) ·
`DataTable` (sort, select, bulk bar, column chooser, cursor paging, responsive card mode, row ⋯, side-panel open) ·
`SidePanel` (desktop record preview with "Open full page") · `RecordHeader` + `StatStrip` · `ActionBar` (primary +
`OverflowMenu`) · `NextStepCard` · `Tabs` · `Timeline` · `Wizard`/`Stepper` · `SettingRow` · `StatusPill` with
tooltip · `InfoTip` (existing) · `EmptyState` (one line + one button) · `Toast` with Undo · `ConfirmDialog` ·
`Skeleton` · `CommandBar`.

**Guards (tests that fail the build):** no `PageHeader` description; no three consecutive bare navigation links;
no paragraph over 140 characters in a desk page outside an `InfoTip`, dialog or document preview; every list page
uses `Toolbar` + `DataTable`; every record page uses `RecordHeader`. A short allow-list covers legal/tax wording that
must be shown in full.

**Look and feel:** consistent density (comfortable rows on phone, compact option on desktop), one type scale, one
spacing scale, real tables on desktop, two-pane layouts (list + side panel) at ≥1024px, sticky headers and toolbars,
instant client-side tab switches, skeletons instead of blank waits, dark mode parity. Evergreen colors and the V
signature layer stay.

## 6. Money area in detail (fixes Billing first)

Tabs: **Overview · Invoices · Payments · Expenses · Books · Taxes**.

- **Overview:** collected this month vs last, billed, outstanding and past due (amount + count), next 30 days expected,
  money needing a decision (held payments, failed charges, deposits to settle) as inbox items with inline actions.
- **Invoices** (Stripe-style work queue): status tabs **Open · Past due · Processing · Paid · Void** with counts (one
  rule mapping existing invoice + Stripe states; "Waiting for Stripe" becomes **Processing**); columns customer,
  number, period, amount, balance, due, status; filters (customer, property, kind: rent/deposit/sale/fee, date range,
  autopay); row ⋯: Record payment, Send reminder, Download PDF, Write off (permission/approval rules unchanged), View
  customer. The invoice record page has status-dependent actions.
- **Payments:** every money-in record (card, ACH, cash, check) with status; **Held payments** is a status filter plus
  inbox items, not a separate page; **Reconciliation** moves to Books → Month review (BA-3) and Money → Payments ⋯.
- **Deposits:** a filter on Payments ("Deposits held") and a section on each rental record; settling a deposit is a
  guided flow started from the rental's ending.
- **Customer statements** move to the customer record's Billing tab (CU-2).
- **Expenses** (from More), **Books** (BA screens) and **Taxes** (sales tax pages regrouped: Returns · Areas & rates ·
  Exemptions · Use tax · Setup, with returns due shown as inbox items) become tabs here.

## 7. Page map (where every current screen goes)

| Current routes | New home |
|---|---|
| `today`, `tasks`, `dashboard`, `control-center`, `approvals`, `notices/*` | **Today** inbox (tasks and approvals are inbox item types; dashboard/control-center content → Today header + area Insights) |
| `leads/*`, `customers/*`, `estimates/*`, `agreements/*`, `communications/*`, `phone-orders/*` | **Customers** tabs Leads · Customers · Quotes · Rentals · Messages; agreement sub-pages (`cancel`, `early-return`, `ending-decision`, `refund`) become one **End this rental** guided flow on the rental record |
| `dispatch`, `jobs/*`, `driver`, `maintenance/*` | **Schedule** tabs Board · Visits · My route · Repairs |
| `inventory/*`, `fleet`, `purchases/*`, `purchase-orders/*`, `parts/*`, `suppliers/*` | **Equipment** tabs Fleet · Purchases · Parts · Suppliers · Retired · Insights; `inventory/[id]/out-of-service`, `split`, `qr` become actions on the appliance record |
| `billing/*`, `sales/*`, `revenue`, `reports`, `expenses`, `books/*`, `sales-tax/*` | **Money** tabs (section 6) |
| `settings/*`, `account`, `security/setup`, `automations`, `privacy`, `preview-storage` | **Settings** (profile menu), sections per 4.2(4); `account` + `security/setup` → "Your account" |
| `growth`, `launch`, `paperwork/*`, `activity`, `search`, `more` | Growth → Customers Insights; Launch list → Today setup card; Paperwork → Settings › Business; Activity → per-record timelines + Settings › Advanced › Activity log; Search → Command bar; More → removed |

## 8. Rollout (each unit one complete PR; old URLs keep working)

| Unit | Scope | Notes |
|---|---|---|
| **AR-0** | Application kit + guards + a **reference set** of three finished screens on the testing site: Today inbox, Money › Invoices, Customer record | Chris looks at these on the testing app (checklist row, never blocks); feedback folds into later units |
| **AR-1** | Navigation: 5 areas, area tabs, profile menu with Settings/account, command bar, redirects, "More" removed | |
| **AR-2** | Today inbox: all To do categories with inline actions and grouping; setup card; dashboard/control-center merged | |
| **AR-3** | Money area: Overview, Invoices, Payments (held/processing/deposits as filters), invoice record | Needs no new money rules |
| **AR-4** | Customers area: Leads queue + lead record (LD-2/LD-3), Customers list + record (CU-2), Quotes, Rentals list + rental record, Messages; "End this rental" flow; hand-offs | Uses LD-1/CU-1 data when built; falls back to current queries until then |
| **AR-5** | Schedule area: board, visit record, route, repairs | |
| **AR-6** | Equipment area: fleet list + appliance record (actions for out-of-service, split, QR), purchases, parts, suppliers, retired | |
| **AR-7** | Money › Books and Taxes screens (BA-4/BA-5 layouts; tax pages regrouped) | Uses BA-1…BA-3 |
| **AR-8** | Settings: one page, sections, search, setting rows with history | |
| **AR-9** | Insights tabs (Customers, Equipment, Money overview) replacing Reports/Revenue/Fleet/Growth pages | |
| **AR-10** | Sweep: every remaining screen on the kit; guards with an empty allow-list except legal text; full browser + axe + phone pass; visual review notes in STATUS | |

**Order:** AR-0 → AR-1 → AR-2 → AR-3 → AR-4 → (AR-5, AR-6 in parallel) → AR-7 → AR-8 → AR-9 → AR-10. Engines BA-1…BA-3,
LD-1, CU-1 can be built in parallel lanes; screens pick them up when merged. Each unit includes browser specs (phone
width, keyboard, axe) for the screens it changes and keeps every old URL reachable.

## 9. What does not change

Business rules, money math, Stripe/tax/communications behavior, permissions and server-side filtering, audit history,
owner switches, the release process, the customer portal and the public website. Any behavior change found necessary
during a unit is written up as a reviewed amendment first (AGENTS).

## 10. Owner decisions

None needed to start. Chris's look at the AR-0 reference screens on the testing app is a checklist row; agents keep
going while it waits and fold his notes into the next units.
