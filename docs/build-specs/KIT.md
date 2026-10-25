# The application kit — exact contracts

Every redesigned desk screen is built only from these pieces. Build them in `src/components/kit/` (new folder; the old
`src/components/ui` and `src/components/desk` stay until AR-10 removes what is unused). Export everything from
`src/components/kit/index.ts`. Each component gets a unit test in `tests/kit/<name>.test.tsx` (render + accessibility
roles + the behaviors listed) unless marked "browser-tested only".

## 1. Tokens (use the existing `@theme` in `src/app/globals.css`; add only the new ones listed)

| Use | Tailwind class | Value |
|---|---|---|
| Page background | `bg-canvas` | ivory `#f7f5ec` |
| Cards, panels, bars | `bg-surface` | `#ffffff` |
| Text | `text-ink` / secondary `text-ink-soft` | `#17251e` / `#4e6658` |
| Borders | `border-line` (light) / `border-line-strong` (controls) | sage / `#a5b8ab` |
| Primary buttons, current tab underline | `bg-primary text-on-primary` | evergreen `#123c2d` |
| Desktop sidebar | `bg-nav-bg text-nav-ink`; current item `bg-nav-current-bg text-nav-current-ink` | existing |
| Attention (late, failed, needs you) | `bg-warning-bg text-warning-ink` | existing |
| Danger (destructive confirm) | `text-danger`, `bg-danger` | existing |
| Good (active, paid) | `text-success` + **new** `bg-success-soft` | add `--color-success-soft: #ddefe3` (light) / `#173a27` (dark) |
| Info (new lead, scheduled) | **new** `bg-info-soft text-info-ink` | add `--color-info-soft: #e3eef8`, `--color-info-ink: #1d4f7a` (light); dark `#16314a` / `#cfe3f5` |
| Card radius | `rounded-card` (16px) | existing |
| Buttons, inputs, chips | **new** `rounded-field` | add `--radius-field: 12px` |
| Raised panel / FAB shadow | `shadow-raise` | existing |

Add the new tokens in **both** light and dark blocks of `globals.css` and to the `@theme` mapping, matching the
existing pattern. Check contrast with the existing contrast test helper (≥4.5:1 text, ≥3:1 large/UI).

**Type scale** (Manrope, already loaded): page title `text-[28px] leading-8 font-extrabold tracking-[-0.5px]`
(phone) / `lg:text-[26px]`; record title `text-[26px] lg:text-[30px] font-extrabold`; section title
`text-base font-bold`; body `text-[15px]`; secondary `text-sm text-ink-soft`; eyebrow/label `text-xs font-bold`;
stat value `text-lg font-extrabold` (phone) / `lg:text-[22px]`. Numbers in tables `tabular-nums`.

**Spacing:** 4 px grid. Phone side gutter `px-5` (20 px). Card padding `px-4 py-3.5`. Gaps between cards `gap-2.5`.
Desktop content padding `px-7 py-6`.

**Sizes:** every tappable control `min-h-11` (44 px) on phones; desktop toolbar controls `h-10`; FAB `h-14 w-14`.

**Breakpoints:** phone = default; tablet `md:` (≥768); desktop `lg:` (≥1024); wide `2xl:` (≥1536). Build phone first.

## 2. New dependencies (pin exactly; all ≥2 weeks old on 2026-10-25)

```
"@radix-ui/react-dialog": "1.2.0",
"@radix-ui/react-dropdown-menu": "2.1.25",
"@radix-ui/react-popover": "1.2.0",
"cmdk": "1.1.1",
"vaul": "1.1.2"
```

Use them only inside `src/components/kit/`. No other UI library. Pages never import Radix/cmdk/vaul directly.

## 3. Shared types (`src/components/kit/types.ts`)

```ts
import type { ReactNode } from "react";
export type Tone = "neutral" | "good" | "attention" | "info" | "danger";
export type ConfirmSpec = { title: string; summary: string; confirmLabel: string; danger?: boolean };
export type ActionSpec =
  | { kind: "link"; label: string; href: string; primary?: boolean }
  | { kind: "tel"; label: string; phone: string; primary?: boolean }      // renders <a href="tel:…">
  | { kind: "mailto"; label: string; email: string; primary?: boolean }
  | { kind: "form"; label: string; action: (fd: FormData) => Promise<unknown>;
      fields?: Record<string, string>; confirm?: ConfirmSpec; undo?: boolean; primary?: boolean;
      pendingLabel?: string };                                             // default pendingLabel "Saving…"
export type MenuItem = ActionSpec & { danger?: boolean };
export type GlossaryKey = import("@/lib/glossary").GlossaryKey;
```

Rule: a `form` action with `confirm` never uses `undo` and is never optimistic. Money actions always have `confirm`.

## 4. Components (contracts)

### 4.1 `ScreenHeader` — top of every list/area screen
`{ title: string; count?: number; primary?: ActionSpec; overflow?: MenuItem[]; back?: { href: string; label: string } }`
- Phone: `back` shows as a 44 px chevron link (aria-label = back.label) left of nothing; title row below.
  `primary` on phone renders as the **FAB** (4.14) when the screen is a list, otherwise as a button in the header.
- Desktop: title left, `primary` (button) + overflow (⋯) right.
- **No description prop.** (Guard 9.1.)

### 4.2 `AreaTabs` — the area's sections (Money: Overview · Bills · Payments · Expenses · Books · Taxes)
`{ label: string; items: { href: string; label: string; count?: number; hidden?: boolean }[] }`
- `<nav aria-label={label}>` of links; current = exact `pathname` match or prefix match (longest wins); current link
  has `aria-current="page"`, `font-extrabold text-primary` and a 3 px bottom border `border-primary`.
- Phone: horizontally scrollable row (`overflow-x-auto`, no visible scrollbar, scroll the current into view on mount).
- Role-filtered **by the caller on the server** (pass only allowed items).

### 4.3 `StatusTabs` — filter a list by status, with counts
`{ label: string; param?: string /* default "status" */; current: string; items: { value: string; label: string; count?: number; hideWhenZero?: boolean }[] }`
- Links that set `?{param}=value` and remove `cursor`; keep other params. `aria-current="page"` on current.
- Phone: pill chips (`h-9 rounded-full`), current filled `bg-primary text-on-primary`, others `bg-surface border`.
  Desktop: segmented control (`bg-tint p-1 rounded-field`, current `bg-surface shadow-sm`).
- Label format: `"{label} {count}"` when count defined (count in `tabular-nums`).

### 4.4 `Toolbar` — search, Filter, Sort, Saved views
```ts
type FilterDef =
  | { kind: "select"; param: string; label: string; options: { value: string; label: string }[] }
  | { kind: "multi"; param: string; label: string; options: { value: string; label: string }[] } // comma-joined
  | { kind: "date"; param: string; label: string }   // presets: this-month, last-month, last-30, custom (from,to)
  | { kind: "toggle"; param: string; label: string };
type SortDef = { value: string; label: string };
type ViewDef = { id: string; label: string; href: string; builtIn: boolean };
{ search?: { param?: string /*"q"*/; placeholder: string; label: string };
  filters?: FilterDef[]; sorts?: SortDef[]; currentSort?: string; views?: ViewDef[]; currentViewId?: string }
```
- Search: `<input type="search">` with visible-to-screen-reader label; updates the URL `q` **250 ms after typing
  stops** using `router.replace` inside `startTransition` (no submit button). Shows a small spinner while pending.
- **Filter** button opens the Filter sheet: phone = `vaul` bottom sheet; desktop = Radix Popover (width 360). Inside:
  one control per FilterDef, "Clear all" and "Show results" buttons. Applying writes params and removes `cursor`.
  Button label shows the active count: `Filter · 2`.
- **Sort**: Radix DropdownMenu with radio items; writes `?sort=`.
- **Views**: DropdownMenu listing built-in views first then saved ones, plus "Save this view" (uses the O-7
  saved-views domain `src/domains/workspace`; route keys registered there).
- Below the toolbar: `ActiveFilterChips` — one removable chip per active filter (`label: value ✕`) and "Clear all".

### 4.5 `DataTable<T>` — the list
```ts
type Column<T> = { key: string; header: string; cell: (row: T) => ReactNode; align?: "left" | "right";
  sortValue?: string /* a SortDef value; makes the header a sort link */; widthClass?: string; desktopOnly?: boolean };
{ caption: string; rows: T[]; rowKey: (row: T) => string; columns: Column<T>[];
  mobileCard: (row: T) => ReactNode;                 // phone rendering of one row
  rowHref?: (row: T) => string;                      // full record page (phone tap, desktop "Open full page")
  panelParam?: string;                               // default "open": desktop row click sets ?open=<rowKey>
  selectedKey?: string;                              // row highlighted (the open panel row)
  rowActions?: (row: T) => MenuItem[];               // ⋯ menu per row
  bulkActions?: { label: string; action: (fd: FormData) => Promise<unknown>; confirm?: ConfirmSpec }[];
  empty: ReactNode;                                  // an EmptyState
  nextHref?: string | null }                         // cursor link for "Load more"
```
- Phone (`<lg`): renders `mobileCard(row)` inside an `<ul>` of cards (`bg-surface rounded-card`), each card a link
  to `rowHref` unless the card has its own buttons (then the title is the link).
- Desktop (`lg:`): `<table>` with `<caption class="sr-only">`, sticky `<thead>`, `tabular-nums`, hover row
  background `bg-tint`, selected row `bg-success-soft`. Clicking a row (or pressing Enter on its first cell link)
  navigates to the same URL with `?open=<key>` (keeps scroll, `scroll: false`).
- `bulkActions`: a checkbox column; when ≥1 selected, a sticky bar appears at the bottom: "{n} selected" + actions.
- "Load more" link at the bottom when `nextHref`; appends by navigating (server re-renders with a larger window —
  see 5.1 cursor rule).

### 4.6 `SidePanel` — desktop record preview beside a list
`{ title: string; closeHref: string; fullHref: string; children: ReactNode }`
- Only rendered at `lg:` and only when the page received `?open=<id>`. `<aside aria-label={title}>` width `w-[420px]`,
  `border-l bg-surface`, its own scroll. Close = link to `closeHref` (aria-label "Close"); Escape key also closes
  (client listener scoped to the panel). Bottom link "Open full page →" to `fullHref`.
- The page server-renders the panel content by calling the same read function the record page uses.

### 4.7 `RecordHeader` + `StatStrip`
`RecordHeader { title: string; pills?: { label: string; tone: Tone; info?: GlossaryKey }[]; subtitle?: string; contact?: { phone?: string; email?: string; address?: string }; primary?: ActionSpec; actions?: ActionSpec[]; overflow?: MenuItem[]; back: { href: string; label: string } }`
- Phone: back chevron + ⋯ in the top row; title + pills; subtitle line; then **three quick buttons** in a 3-column
  grid built from `contact` (Call / Email / Map, each only if present; Map = `https://maps.google.com/?q=` + address).
  `primary` and `actions` move to the sticky bottom action bar (4.13).
- Desktop: breadcrumb (`back.label / title`) in the top bar; title + pills + one-line contact on the left; `primary`,
  `actions`, ⋯ on the right.
`StatStrip { items: { label: string; value: string; tone?: Tone; info?: GlossaryKey }[] }` — phone: 2 columns inside
one card; desktop: up to 5 equal cards in a row. `tone: "attention"` colors the value `text-warning-ink`.

### 4.8 `NextStepCard`
`{ title: string; actions: ActionSpec[] /* 1–2 */; tone?: "attention" | "info" }` — eyebrow text is always
"Next step". Attention = `bg-warning-bg/40 border border-warning-bg`. Render nothing if there is no next step.

### 4.9 `InboxCard` (Today)
`{ eyebrow: string; eyebrowTone: Tone; title: string; detail?: string; actions: ActionSpec[] /* max 2 shown */; overflow?: MenuItem[] }`
- Card with eyebrow (`text-xs font-bold`, tone color), title (`text-base font-bold`), detail (`text-sm text-ink-soft`),
  then a row: first action as primary button (flex-1), second as secondary, ⋯ if overflow.
- Severity "high" items get `border border-warning-bg`.

### 4.10 `Timeline`
`{ items: { id: string; at: Date; title: string; detail?: string; tone: Tone; actor: string /* "automatic" or a name */ }[]; emptyLabel: string }`
— dot (8 px, tone color) + title (`font-bold`) + `"{formatShortDate(at)} · {actor}"`. Newest first.

### 4.11 `EmptyState`
`{ title: string /* one line */; action?: ActionSpec }` — centered, no paragraph (guard 9.3).

### 4.12 `ConfirmDialog`
Used by any `form` ActionSpec with `confirm`. Radix Dialog: title, summary (one or two short sentences, exact text from
the screen spec), Cancel + confirm button (`danger` → `bg-danger`). Focus starts on Cancel. Confirm submits the form.

### 4.13 `ActionBar` (phone record bottom bar) and `ActionButton`
- `ActionBar { actions: ActionSpec[] /* 1–2 */ }`: sticky bottom bar above the safe area
  (`pb-[max(0.75rem,env(safe-area-inset-bottom))]`), shown `<lg` only.
- `ActionButton { spec: ActionSpec; size?: "md" | "lg"; variant?: "primary" | "secondary" }` renders the right element
  per kind; `form` kind = `<form action>` + hidden fields + submit button that uses `useFormStatus` to show
  `pendingLabel` and `disabled` while pending; with `undo: true` shows an Undo toast on success (4.15).

### 4.14 `Fab` — phone primary action on lists
`{ spec: ActionSpec }` — `fixed right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] h-14 w-14 rounded-full
bg-primary shadow-raise`, `aria-label={spec.label}`, plus icon. Hidden `lg:`.

### 4.15 `Toaster` + `toast()`
In-house: a client provider mounted once in the desk layout; `role="status" aria-live="polite"`; bottom-center on
phone above the bottom bar, bottom-right on desktop; 6 s default, 10 s when `undo`. API:
`toast({ message: string; tone?: Tone; undo?: () => Promise<void> })`. Undo button label "Undo".

### 4.16 `Skeleton`
`<Skeleton className="h-4 w-40" />` (animated pulse, disabled under `prefers-reduced-motion`) and ready-made
`ListSkeleton` (6 cards phone / 8 rows desktop), `RecordSkeleton`, `InboxSkeleton`. Used by `loading.tsx` files.

### 4.17 `StatusPill` (new kit version)
`{ label: string; tone: Tone; info?: GlossaryKey }` — `text-xs font-bold px-2 py-0.5 rounded-full`; tone colors:
good `bg-success-soft text-success`, attention `bg-warning-bg text-warning-ink`, info `bg-info-soft text-info-ink`,
danger `bg-danger/10 text-danger`, neutral `bg-tint text-ink-soft`. With `info`, the pill is a button that opens a
Popover with the glossary entry ("what this means and what happens next").

### 4.18 Later-unit components (specified here, built in the unit named)
- `AppFrame`, `Sidebar`, `BottomBar`, `ProfileMenu` (AR-1) — see AR-1 card.
- `CommandBar` (AR-1, cmdk) — see AR-1 card.
- `SettingRow`, `SettingsLayout` (AR-8).
- `Wizard`, `Stepper` (AR-4).

### 4.19 `Sheet` — a small form on top of the page
`{ open: boolean; onOpenChange(open: boolean): void; title: string; children: ReactNode; footer?: ReactNode }` —
phone (< 1024 px, `useMediaQuery("(min-width: 1024px)")` false) = `vaul` bottom sheet with a grab handle, max height
90 dvh, content scrolls; desktop = Radix Dialog, width 480, centered. Title is the accessible name. Escape and the
backdrop close it; focus returns to the opener. Used for: Snooze (TODAY 5), Add a note (CUSTOMER-RECORD 4.6), the
Filter sheet (4.4 uses the same component), later the inline payment sheets (AR-3).

### 4.20 Logo
Use only the brand-kit files ([DESIGN-SYSTEM.md "Logo rule"](../DESIGN-SYSTEM.md)): `/brand/badge.svg` (round
evergreen badge, ivory R, lime leg) for every small logo in the app (sidebar, phone top bar, sign-in, account);
`/brand/logo-light.svg` / `logo-dark.svg` for the full logo. Never recolor or redraw it; never one-color on screens.

### 4.21 `Icon` — one small icon set, no icon library
`<Icon name={IconName} size={20|24} className? />` in `src/components/kit/icons.tsx`; `aria-hidden="true"` always
(the button or link around it carries the words). Shapes are copied from **Lucide** (ISC license — keep its
copyright line in a comment at the top of the file): run `npm pack lucide-static@0.468.0` in the scratch folder
(do **not** add it as a dependency), open `package/icons/<name>.svg`, and paste each icon's inner elements into a
`Record<IconName, ReactNode>`. Stroke `currentColor`, width 2, round caps and joins, viewBox `0 0 24 24`.
| IconName | Lucide file | Used for |
|---|---|---|
| today | `inbox` | Today area |
| customers | `users` | Customers area |
| schedule | `calendar-days` | Schedule area |
| equipment | `washing-machine` | Equipment area |
| money | `wallet` | Money area |
| search | `search` | search / command bar |
| plus | `plus` | Fab, "+ New …" |
| more | `ellipsis` | ⋯ menus |
| back | `chevron-left` | back links |
| down | `chevron-down` | dropdowns |
| phone | `phone` | Call |
| email | `mail` | Email |
| map | `map-pin` | Map / addresses |
| filter | `sliders-horizontal` | Filter |
| sort | `arrow-up-down` | Sort |
| gear | `settings` | AutomationLine, Settings |
| check | `check` | done, selected |
| close | `x` | close, remove chip |
| info | `info` | InfoTip trigger (replaces the ⓘ character in kit components) |
| offline | `wifi-off` | OfflineBar |
| collapse | `panel-left` | collapse the sidebar |
| help | `circle-help` | Help |
| signout | `log-out` | Sign out |
Build `Icon` first (before StatusPill) in AR-0a step 4.

## 5. Page patterns (copy these structures)

### 5.1 Work queue page (server component)
```
<ScreenHeader title count primary overflow />
<AreaTabs …/>                      (if the screen is inside an area)
<StatusTabs …/>
<Toolbar …/> <ActiveFilterChips/>
<div class="lg:flex lg:gap-0">
  <section class="min-w-0 flex-1"> <DataTable …/> </section>
  {open && <SidePanel …/>}         (lg only)
</div>
<Fab/>                              (phone only, from ScreenHeader.primary)
```
- URL is the state: `status`, `q`, filter params, `sort`, `view`, `open`, `cursor`. Parse with one zod schema per page
  (`src/app/desk/<route>/params.ts`), unknown values fall back to defaults (never throw).
- **Cursor rule ("Load more" grows the window):** order by `(sortColumn, id)`; page size 50. With no `cursor` the
  server renders the first 50 rows. `cursor` = base64url JSON `{ v, id }` of the **last row currently shown**. With a
  cursor the server renders every row from the start **through the cursor row, plus the next 50 rows after it**
  (one query: `take: rowsThroughCursor + 50`, or two queries — rows up to and including the cursor, then 50 after it;
  either is fine). The new "Load more" link carries the new last row as its cursor. Show "Load more" only when one
  more row exists (fetch 51 and drop the extra). Cap the window at 500 rows; at the cap the link is replaced by the
  text "Narrow your filters to see more". Test: 120 rows → first render 50, after one Load more 100, after two 120
  and no link; every row appears exactly once.
- Counts for StatusTabs come from **one** `groupBy`/`count` query with the same filters except status.

### 5.2 Record page
```
<RecordHeader …/>  <StatStrip …/>  <NextStepCard …/>
<AreaTabs label="… sections" items=[record tabs as ?tab=] />
<div class="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
  <section> (current tab content) </section>
  <aside class="hidden lg:flex lg:flex-col lg:gap-4"> <NextStepCard/> <Timeline/> </aside>
</div>
<ActionBar …/>  (phone)
```
- On phone the Timeline is the "Activity" tab (first tab); on desktop it is in the right column and the first tab is
  the record's main content.

### 5.3 Loading and errors
- Every migrated route gets a `loading.tsx` using the matching skeleton.
- Every migrated route segment gets an `error.tsx` showing: "Something went wrong loading this page." + "Try again"
  (reset) + "Go to Today", and reports via the existing `src/lib/report-error.ts`.

## 6. Interaction rules

6.1 **Pending:** every form button shows `pendingLabel` and is disabled while pending (useFormStatus).
6.2 **Success:** toast with a past-tense message ("Reminder sent to Maria Lopez"). Reversible actions add Undo.
6.3 **Errors:** field errors inline under the field (`text-sm text-danger`, `aria-describedby`); action errors as a
    danger toast with the server's plain message; never a raw error.
6.4 **Optimistic:** only for actions listed as `optimistic` in a screen spec (snooze, mark done, set follow-up date,
    add note). Use React `useOptimistic`; on failure, revert and show the error toast.
6.5 **Disabled with reason:** a disabled action shows an `InfoTip`-style popover on tap with the reason string from
    the screen spec.
6.6 **Money confirmations** (exact format): title = the action ("Take a $70.00 payment?"); summary =
    "{amount} from {customer}'s {card brand} ending {last4}. This can't be undone." Use only data already loaded.
6.7 **Focus:** after a dialog closes, focus returns to the trigger; after navigation, focus moves to the `<h1>`.

## 7. Framework guides to read before building (in `node_modules/next/dist/docs/01-app/02-guides/`)

`interactive-apps.md` (optimistic UI, pending states), `forms.md`, `server-actions.md`, `instant-navigation.md` and
`prefetching.md` (AR-11), `preserving-ui-state.md` (lists keep state), `offline-support.md` and
`progressive-web-apps.md` (AR-11), `view-transitions.md` (AR-11 — it needs React 19.3's `<ViewTransition>`; AR-11 step 0 upgrades React to 19.3.0
first; the kit PR AR-0a does not change React).

## 8. Words (everyday screens)

Use [APP-REDESIGN.md section 4D.6](../designs/APP-REDESIGN.md) as the dictionary: **bill** (not invoice), **money
customers owe you**, **check against your bank**, **give up on this bill**, **rental** (not agreement), **appliance
number**. Buttons start with a verb, sentence case ("Take payment", "Send reminder"). Statuses are adjectives or
short phrases ("Active", "5 days late", "Paid"). Numbers: `formatMoney`. Dates (all in `src/lib/business-date.ts`, all
America/Denver, unit-tested across both DST changes and New Year):
- `formatShortDate(date, now = new Date())` (new) — "Oct 25" in the current year, "Oct 25, 2025" otherwise. The
  default in lists, cards, pills, timelines and stat strips.
- `formatMonthYear(date)` (new) — "March 2026".
- `formatWeekdayDate(date)` (new) — "Sunday, Oct 25" (Today's date line).
- `formatBusinessDate(date)` (existing, long: "Sunday, October 25, 2026") — only on documents, confirmations and
  side-panel/record detail fields where the full date matters.
- `relativeBusinessDay(date, now)` (new) — "today", "yesterday", "tomorrow", "in 3 days", "3 days ago"; beyond 6 days
  falls back to `formatShortDate`.
- `ordinal(n)` (new) — "1st", "2nd", "3rd", "4th", "11th", "21st".

## 9. Guards (tests that fail CI) — `tests/kit-guards.test.ts`

Apply to every page listed in `docs/build-specs/migrated-pages.json` (an array of route files; each card adds its
pages). AR-10 makes the list "all desk pages".
1. No `description=` prop on `ScreenHeader`/`PageHeader` in a migrated page.
2. No three consecutive sibling JSX lines that are bare navigation links (`<Link`/`<a` with only text children and
   no `ActionButton`/kit wrapper).
3. No visible text node longer than 140 characters (reuse `visibleText()` from `scripts/check-owner-wording.mjs`),
   except inside `InfoTip`, `ConfirmDialog` or files in `scripts/kit-guard-allowlist.json` (each entry needs a reason;
   only legal/tax wording may be listed).
4. List pages import `DataTable` and `Toolbar` from `@/components/kit`; record pages import `RecordHeader`.
5. No import of `@radix-ui/*`, `cmdk` or `vaul` outside `src/components/kit/`.
