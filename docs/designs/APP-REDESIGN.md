# Appliance Desk as an application — app-wide redesign (Batch AR)

Status: **designed 2026-10-25 at Chris's request; not built.** Units AR-0…AR-11 are in `work-index.json`; execution
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

## 4A. How the best web apps feel like real software — and what Appliance Desk does about it

Chris (2026-10-25): "figure out how the best web apps are made to look and feel like an actual software program, and
apply that knowledge to Appliance Desk." Research and what it means here:

**What the best ones do** (Linear, Stripe, Shopify admin, Figma, Notion; sources below):
1. **The frame never reloads.** Sidebar, top bar and bottom bar stay put; only the content area changes, instantly.
2. **Every click answers immediately.** Changes appear on screen at once (optimistic updates) and save in the
   background; if a save fails, the change rolls back with a clear message. Linear keeps data in the browser so reads
   don't wait on the network.
3. **Nothing ever goes blank.** Skeletons in the exact shape of the content, never a spinner on a white page.
4. **Keyboard and command bar first on desktop**; touch gestures first on phones (swipe actions, bottom sheets,
   pull to refresh).
5. **Installed like an app:** its own icon, opens in its own window without browser bars, a splash colour, app-icon
   shortcuts, the window title follows the screen, and it respects notches and rounded corners.
6. **Restrained, purposeful motion:** short transitions using only movement and fade, shown only when they explain
   where something went; reduced for people who ask the system for less motion.
7. **Application chrome, not web-page chrome:** controls are not selectable text, no underlined links for navigation,
   consistent hover/pressed/focus states, menus and dialogs that look like the operating system's.
8. **State is remembered:** returning to a list restores filters, scroll position and the selected row; drafts are
   kept; deep links open exactly the record.
9. **Speed is a product rule**, measured and budgeted like any other requirement, so it doesn't erode.

**Where Appliance Desk is today** (checked 2026-10-25): one manifest shared with the public website (`start_url: "/"`,
name "Robinson Appliance Rentals"), so an installed icon opens the marketing site; no app-icon shortcuts; no offline
or "you're offline" handling; one loading screen for the whole desk (`src/app/desk/loading.tsx`); optimistic updates in
only a couple of places; no command bar or keyboard shortcuts; one fixed theme colour (no dark variant); navigation
mostly full server round-trips with no transitions; safe-area handled only on the bottom tab bar.

**What we build (AR-11, "app feel foundations", right after AR-0):**
- **Installable desk app:** a separate desk manifest (`/desk/manifest.webmanifest`, name "Appliance Desk", start
  `/desk/today`, scope `/desk/`, `display_override: ["window-controls-overlay", "standalone"]`, maskable icons, light and
  dark theme colours) with app-icon **shortcuts**: New quote, Record payment, Today's route, Add expense. The public
  site keeps its own. On desktop, the title-bar area holds the search/command bar (window controls overlay).
- **Instant shell:** persistent `AppShell`; Next.js client navigation with prefetch of the five areas and visible list
  rows; route-level `loading.tsx` skeletons per area and per record type; cross-fade/slide **view transitions** between
  list and record (disabled under reduced motion); per-view `<title>`.
- **Optimistic actions** through one helper around React `useOptimistic` + server actions for safe, reversible actions
  (mark task done, snooze, set follow-up, assign, change stage, add note, mark visit complete), with **Undo** toasts.
  Money, signatures, refunds and anything irreversible stay confirm-then-save (no optimistic money, ever).
- **Live freshness:** lists and Today refresh themselves when the window regains focus and every 60 seconds while
  visible (cheap count queries), so two people never act on stale screens; "Updated just now" indicator.
- **Offline-aware:** a small service worker caches the app shell and static assets only (never customer data); when
  offline, the shell stays up with a clear "You're offline — changes are paused" bar and actions disabled. Drivers'
  route view caches today's stops read-only for dead zones (explicit, private, cleared at sign-out).
- **Keyboard:** `⌘K`/`Ctrl K` command bar, `/` focus search, `j`/`k` move in lists, `Enter` open, `Esc` close panel,
  `g t` / `g c` / `g s` / `g e` / `g m` go to areas, `?` shows shortcuts. All discoverable in the command bar.
- **Touch:** swipe row actions, bottom sheets for filters and menus, pull-to-refresh on lists (`overscroll-behavior`
  contained elsewhere), 44px targets, `viewport-fit=cover` with safe-area insets everywhere.
- **Chrome polish:** `user-select: none` on controls only; consistent pressed/hover/focus tokens; system-native date,
  time and number inputs styled to the brand; `accent-color` for checkboxes and radios.
- **State memory:** filters, sort, scroll and selected row restored per list (URL + session storage, wrapped safely);
  unsaved form drafts kept locally until submitted or discarded.
- **Performance budget (a test, not a hope):** on a mid-range phone over 4G, desk area switch shows content or a
  skeleton within 100 ms and usable content within 1 s; record open within 300 ms from a list; JavaScript per area
  under a fixed budget checked in CI (bundle-size check) alongside the existing capacity baselines.

Sources: [web.dev — PWA app design](https://web.dev/learn/pwa/app-design), [web.dev — PWA enhancements](https://web.dev/learn/pwa/enhancements),
[Why Linear feels fast](https://dev.to/0xgosu/why-linear-feels-fast-local-data-small-updates-and-product-discipline-1m53),
[How is Linear so fast](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown.md),
[Optimistic updates make apps faster](https://blog.openreplay.com/optimistic-updates-make-apps-faster/).

## 4B. Mobile first, and excellent on a PC (Chris, 2026-10-25)

Chris runs the business mostly from his phone, in the truck and at customers' doors. Every screen is **designed at
phone size first (390 px wide, one hand, thumb reach)** and then **expanded** for larger screens — never a desktop page
squeezed down.

**On a phone:**
- Bottom bar with the five areas; the area's tabs scroll horizontally under the top bar.
- The primary action sits in the **thumb zone**: a floating "+" or a sticky bottom action bar on records and flows.
- Lists are **cards** with the 3–4 facts that matter; swipe for the top two actions; long-press or ⋯ for the rest.
- Filters, sort, menus and confirmations open as **bottom sheets**; records open full screen with a back gesture.
- Forms are one column, big inputs, the right keyboard per field (number, phone, email), camera for receipts and
  photos, tap-to-call and tap-to-map everywhere a phone number or address appears.
- Works with poor signal: skeletons, offline bar, today's route cached read-only (section 4A).

**On a PC (from 1024 px wide):**
- Sidebar with the five areas, collapsible; top bar with the command bar.
- **List + side panel**: clicking a row opens the record on the right without leaving the list; "Open full page" when
  needed. On wide screens (1440 px+), a third column shows the next-step card and activity.
- Real tables: sortable and resizable columns, column chooser, multi-select with a bulk action bar, hover row actions.
- Keyboard shortcuts and the command bar (section 4A); right-click context menu on rows.
- Dialogs instead of full-screen sheets; forms in two columns where it helps.

**Tablet (768–1023 px):** phone patterns with two-column cards and side panels as overlays.

**Proof:** every AR unit's browser specs run at 360 × 740 (small phone), 390 × 844 (standard phone), 820 × 1180
(tablet), 1280 × 800 and 1920 × 1080, with axe and keyboard checks; the AR-0 reference screens are reviewed at phone size
first. No horizontal scrolling on phones except inside tables built to scroll.

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
| **AR-11** | App feel foundations (section 4A): desk app install + shortcuts, instant shell, skeletons, view transitions, optimistic helper with Undo, live freshness, offline shell, keyboard and touch, state memory, performance budget in CI | Right after AR-0; every later unit uses it |
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

**Order:** AR-0 → AR-11 → AR-1 → AR-2 → AR-3 → AR-4 → (AR-5, AR-6 in parallel) → AR-7 → AR-8 → AR-9 → AR-10. Engines BA-1…BA-3,
LD-1, CU-1 can be built in parallel lanes; screens pick them up when merged. Each unit includes browser specs (phone
width, keyboard, axe) for the screens it changes and keeps every old URL reachable.

## 9. What does not change

Business rules, money math, Stripe/tax/communications behavior, permissions and server-side filtering, audit history,
owner switches, the release process, the customer portal and the public website. Any behavior change found necessary
during a unit is written up as a reviewed amendment first (AGENTS).

## 10. Owner decisions

None needed to start. Chris's look at the AR-0 reference screens on the testing app is a checklist row; agents keep
going while it waits and fold his notes into the next units.
