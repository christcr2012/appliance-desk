# Screen spec — Navigation: five areas, area tabs, profile menu, command bar

Built in **AR-1**. Visual targets: the sidebar, top bar and bottom bar in `samples/CustomerDesktop.dc.html`,
`samples/InvoicesDesktop.dc.html` (PC) and `samples/TodayPhone.dc.html` (phone). Kit: KIT.md (`Icon` 4.21, `Sheet`
4.19, logo 4.20).

## 1. One source of truth: `src/lib/desk-areas.ts` (new, pure, no database)

```ts
export type AreaKey = "today" | "customers" | "schedule" | "equipment" | "money";
export type Restriction = "finance" /* OWNER, ADMIN */ | "owner" /* OWNER */;
export type AreaTab = { key: string; href: string; label: string; restriction?: Restriction;
  /** extra path prefixes that light up this tab (most specific wins) */ matches?: string[];
  /** optional query rule: the tab is active only when this param has one of these values */ query?: { param: string; values: string[] };
  feature?: FeatureKey /* AR-12, optional */ };
export type Area = { key: AreaKey; label: string; icon: IconName; tabs: AreaTab[] };
export const DESK_AREAS: Area[]
export type ProfileLink = { href: string; label: string; restriction?: Restriction };
export const PROFILE_LINKS: ProfileLink[]
export function visibleAreas(role: string | undefined, jobRoleScreens: readonly string[] | null, shown?: Set<FeatureKey>): Area[]
export function areaHome(area: Area): string            // the first visible tab's href
export function activeArea(pathname: string, search: URLSearchParams, areas: Area[]): { area: AreaKey; tab: string } | null
export function visibleProfileLinks(role: string | undefined, jobRoleScreens: readonly string[] | null): ProfileLink[]
```

**Visibility rule (same order everywhere, server side):** role restriction → `jobRoleAllowsPath(jobRoleScreens,
href)` → AR-12 feature visibility (`isHrefHidden`). An area with no visible tab is not shown. Never trust the client.

**`DESK_AREAS` (exact):**

| Area | Tab key · label · href · restriction · matches |
|---|---|
| Today (`today`) | inbox · "Inbox" · `/desk/today` · — · `/desk/dashboard`, `/desk/control-center`, `/desk/approvals`, `/desk/notices`, `/desk/launch` |
| | tasks · "Tasks" · `/desk/tasks` · — |
| Customers (`customers`) | leads · "Leads" · `/desk/leads` · finance |
| | customers · "Customers" · `/desk/customers` · — · `/desk/growth` |
| | quotes · "Quotes" · `/desk/estimates` · finance |
| | rentals · "Rentals" · `/desk/agreements` · — · `/desk/phone-orders` |
| | messages · "Messages" · `/desk/communications` · — |
| Schedule (`schedule`) | board · "Board" · `/desk/dispatch` · — |
| | visits · "Visits" · `/desk/jobs` · — |
| | route · "My route" · `/desk/driver` · — |
| | repairs · "Repairs" · `/desk/maintenance` · — |
| Equipment (`equipment`) | fleet · "Fleet" · `/desk/inventory` · — · `/desk/fleet` |
| | purchases · "Purchases" · `/desk/purchases` · finance · `/desk/purchase-orders` |
| | parts · "Parts" · `/desk/parts` · — |
| | suppliers · "Suppliers" · `/desk/suppliers` · finance |
| | retired · "Retired" · `/desk/inventory/retired` · finance |
| Money (`money`) | overview · "Overview" · `/desk/revenue` · finance · `/desk/reports` (AR-3 moves it to `/desk/money`) |
| | bills · "Bills" · `/desk/billing` · finance · `/desk/sales`, `/desk/billing/customer` |
| | payments · "Payments" · `/desk/billing?view=deposits` · finance · `/desk/billing/held-payments`, `/desk/billing/reconciliation`, `/desk/billing/deposits`; query `view` ∈ `deposits, waiting` |
| | expenses · "Expenses" · `/desk/expenses` · — |
| | books · "Books" · `/desk/books` · finance |
| | taxes · "Taxes" · `/desk/sales-tax` · finance |

Restrictions in this table are final and match what each page's data functions enforce today (for example Leads
is OWNER/ADMIN because `getLeadWorkspace` calls `requireRole("OWNER", "ADMIN")`; the current menu wrongly shows it to
staff). Proof is a browser test, not a text check: signed in as the seeded STAFF user, open every tab the navigation
shows and assert none of them shows the access refusal; and as OWNER, every tab opens.

**Active tab:** for `pathname` + `search`, among all visible tabs pick the one whose `href` path or `matches` prefix
is the longest match (`pathname === p || pathname.startsWith(p + "/")`). A tab's `query` rule applies **only to its
own `href` path** (Payments' `/desk/billing`): that path matches only when the param value fits, and then wins over a
tab with the same path. Its `matches` prefixes (`/desk/billing/held-payments` etc.) match by path alone, with no query
rule. Unit-test: `/desk/billing` → bills;
`/desk/billing?view=deposits` → payments; `/desk/billing/held-payments` → payments; `/desk/billing/customer/x` →
bills; `/desk/inventory/retired` → retired; `/desk/inventory/abc` → fleet; `/desk/settings` → none.

**`PROFILE_LINKS` (exact, in order):** "Settings" `/desk/settings` (finance) · "Your account" `/desk/account` ·
"Website" `/desk/settings/website` (finance) · "Business paperwork" `/desk/paperwork` (owner) · "Privacy requests"
`/desk/privacy` (owner) · "System health" `/desk/automations` (finance) · "Activity log" `/desk/activity` · "Help"
`/desk/help` (only if the route exists — AR-12) · then two non-links: "Keyboard shortcuts" (desktop, opens AR-11's
shortcuts sheet if present) and the theme switch, then "Sign out".

`src/lib/desk-navigation.ts` and `src/lib/desk-sections.ts` become thin wrappers over `desk-areas.ts` (keep their
exported names so existing imports compile; mark them `@deprecated` — AR-10 deletes them). `deskMoreLinks` returns
the profile links.

## 2. Shell components (kit, `src/components/kit/`)

**`AppFrame`** (server) replaces `AppShell` in `src/app/desk/layout.tsx`. Props: `{ areas, profileLinks, user: {
name, email, initials, role }, children }`. It renders `Sidebar` (lg), `TopBar`, `BottomBar` (phone) and the content
`<main id="main" tabIndex={-1}>`. A "Skip to content" link first in the DOM. Keep `IdleLogout` as is.

**`Sidebar`** (desktop `lg:`; client for the active state and collapse):
- Width 248 px (`w-62`), `bg-nav-bg text-nav-ink`, fixed left, full height.
- Top: badge logo 32 px + "Appliance Desk" (`font-bold`), link to `/desk/today`.
- Five area rows: `Icon` 20 + label, `min-h-10 rounded-field px-3`, current area `bg-nav-current-bg
  text-nav-current-ink font-bold`, others hover `bg-white/10`. Link to `areaHome(area)` (AR-11's remembered list
  query is used when present). Today shows a count pill when the last known inbox count > 0 (see 2.1).
- Bottom: profile button (initials circle + name + role word "Owner"/"Admin"/"Staff"), opens `ProfileMenu` upward.
- Collapse button (`Icon collapse`, label "Collapse menu"/"Expand menu"): collapsed = 72 px, icons only with
  `title`/tooltip; state saved in `localStorage` key `desk.sidebar` (try/catch; default expanded).

**`TopBar`**:
- Desktop: height 56, `bg-surface border-b border-line`; left = breadcrumb from the page (`area label / record
  name` — pages pass it through `<PageTitle crumbs={…}/>`, a small client store; default = area label); center-right
  = command bar trigger styled as a search field (`Icon search` + "Search or jump to anything…" + `Ctrl K` hint,
  width 360); right = nothing else (profile lives in the sidebar).
- Phone: height 56 + safe-area top; left = back button when the page set a `back` crumb, else the area label as
  title; right = search button (`Icon search`, label "Search") and the profile button (initials, 36 px) which opens
  `ProfileMenu` as a Sheet. Pages that have their own big header (Today, records) set `hideTitle` so the bar shows
  only the buttons.

**`BottomBar`** (phone, `lg:hidden`): fixed bottom, `bg-surface border-t border-line`, safe-area bottom, five equal
items (`Icon` 24 + label `text-[11px] font-semibold`), current = `text-primary` with a 3 px top bar
`bg-primary`, others `text-ink-soft`. Items = visible areas in fixed order Today, Customers, Schedule, Equipment,
Money (same for every role; an area the person cannot see is simply absent). Today shows the count pill.

**`AreaTabs`** (built in AR-0; now placed by layouts): every area folder's `layout.tsx` renders
`<AreaTabs area="money" />` (server wrapper that computes visible tabs for the session, then the client tab strip)
instead of `<SectionTabs …/>`. Add layouts to the folders that have none: leads, customers, estimates, agreements,
communications, phone-orders, maintenance, suppliers, expenses, books, sales-tax, tasks, today, inventory/retired is
covered by inventory. Phone: horizontally scrolling underline tabs under the top bar, current tab scrolled into view.
Desktop: the same strip under the page header. Hidden when the area has fewer than 2 visible tabs.

### 2.1 Today count without extra database work
The Today page (which already loads the inbox) renders `<InboxCountBeacon count={n} />` (client) that writes `n` to
`sessionStorage` key `desk.inboxCount` and dispatches a `desk:inbox-count` event; Sidebar and BottomBar read it
(try/catch) and listen to the event. No other page queries the count. Shown as `99+` above 99.

## 3. Profile menu (`ProfileMenu`)
Desktop: Radix DropdownMenu opening above the sidebar profile button, width 260. Phone: Sheet titled with the
person's name. Contents: name + email (non-interactive header), then `visibleProfileLinks` as menu items, a
separator, the theme switch (existing `ThemeToggle`), "Sign out" (existing sign-out handler from `app-shell.tsx`,
moved here unchanged, plus AR-11's cache clear if present).

## 4. Command bar (`CommandBar`, cmdk inside a Radix Dialog)

- Opens with **Ctrl K / ⌘K** anywhere in the desk (also while typing in an input), the top-bar search field, and the
  phone search button. Phone: full-screen. Desktop: centered, width 640, top 15 vh. Escape closes; focus returns.
- Input placeholder "Search customers, appliances, bills… or type what you want to do". Results update 150 ms after
  typing stops; nothing is searched under 2 characters.
- Groups and order:
  1. **Go to** — areas and tabs (visible ones) whose label starts with or contains the text, plus profile links.
     With an empty input, this group shows the five areas.
  2. **Do** — actions (each shown only if its href is visible to the person under the same visibility rule):
     "New quote" `/desk/estimates/new`, "New rental" `/desk/agreements/new`, "New customer" `/desk/customers/new`,
     "New lead" `/desk/leads/new`, "Schedule a visit" `/desk/jobs/new`, "Add an expense" `/desk/expenses#add-expense`,
     "Record a purchase" `/desk/purchases/new`, "Add a supplier" `/desk/suppliers/new`, "Take a payment"
     `/desk/billing?status=open`. Matched on label words and synonyms (`payment`: pay, charge, card; `quote`:
     estimate, price; `rental`: agreement, contract; `visit`: job, delivery, pickup; `expense`: receipt, cost).
  3. **Records** — server action `commandSearchAction(q)` in `src/app/desk/command-actions.ts` calling the existing
     `searchAll(q)` (it already applies roles and job roles; never widen it). Show at most 5 per kind: customers
     (name · company or email → `/desk/customers/{id}`), appliances (`{assetNumber} · {typeName}` →
     `/desk/inventory/{id}`), leads (`{contactName}` → `/desk/leads/{id}`), purchases (`{seller} · {date}` →
     `/desk/purchases/{id}`), suppliers (`{name}` → `/desk/suppliers/{id}`). (All five detail routes exist.)
  4. **Help** — AR-12's `HELP_GUIDES` whose question or keywords match (top 3); choosing one opens its Sheet.
  Last row always: "See all results for “{q}”" → `/desk/search?q={q}`.
- Keyboard: arrows move, Enter opens, Ctrl/⌘+Enter opens in a new tab.
- Recent: the last 5 opened records are remembered in `localStorage` `desk.recent` (id, label, href; try/catch) and
  shown under "Recent" when the input is empty. Cleared at sign-out.

## 5. Redirects and removals

- `/desk/more` → `redirect("/desk/today")` (its links now live in the profile menu and the command bar). Delete the
  More page's content component; keep the route file with only the redirect.
- `/desk/control-center` → `redirect("/desk/today")`.
- `/desk/search` stays (the "See all results" page) but loses its menu entry; its own search box stays.
- Remove `GlobalSearchBox` from the shell (the command bar replaces it). Keep the component file until AR-10.
- Every other URL keeps working unchanged.

## 6. Words (exact)
Area labels "Today", "Customers", "Schedule", "Equipment", "Money"; tab labels as in the table; "Appliance Desk";
"Search or jump to anything…"; "Search"; "Collapse menu" / "Expand menu"; "Skip to content"; profile items as listed;
"Sign out"; command bar group titles "Go to", "Do", "Records", "Help", "Recent"; "See all results for “{q}”";
empty result "Nothing found. Try a name, phone number or appliance number."

## 7. Tests
- `tests/desk-areas.test.ts`: visibility per role (OWNER, ADMIN, STAFF), job-role narrowing (a staff job role
  without `dispatch` loses the Schedule area), active-tab table (section 1), every tab href has a route file.
- Update `tests/desk-navigation.test.ts`, `tests/w8-menu-sections.test.ts`, `tests/e2-app-shell.test.tsx`,
  `tests/acc5-job-role-rules.test.ts`, `tests/taxes-in-one-place-w3.test.ts`, `tests/vc4-website-editor.test.ts`
  for the new structure: same guarantees (staff never receives a finance link in the serialized props), new labels.
  Update `scripts/preflight.mjs`'s path→test map to point `src/lib/desk-areas` at `tests/desk-areas.test.ts`.
- `tests/kit/command-bar.test.tsx`: groups, 2-character minimum, synonyms, hidden actions not listed for staff.
- `tests/command-actions-integration.test.ts` (throwaway Postgres): staff search never returns leads or purchases.
- `e2e/navigation.spec.ts`: phone bottom bar shows 5 areas for owner and the right ones for staff; area tabs scroll
  and mark the current tab; Ctrl K opens the command bar, typing a seeded customer's name and Enter opens the record;
  `/desk/more` lands on Today; staff opens every tab it is shown without a refusal (section 1); sidebar collapse is remembered; axe + 5 sizes; keyboard: Skip to content works.
