# Design — Batch E2: Visual redesign of the owner desk, customer portal and public site (desktop, phone, light, dark)

Status: **APPROVED DESIGN — implement from this document** (Chris, 2026-10-05: "I approve e2 and b2"). The owner-desk direction is approved
(Chris, 2026-10-04) and the public home page direction is decided (IN-32, Chris 2026-10-04: ivory in light mode,
evergreen in dark mode). Written
2026-10-05 by Claude Opus 5.5 against `main` 47bd833, before Batch E is built, so section 0 lists the facts E must
leave behind; re-check them when E merges. Replaces the prompt `docs/archive/prompts/DESIGN-BATCH-E2-REDESIGN.md`.

Scope and acceptance: `docs/PLAN.md` → Batch E2. Reference: `docs/ROADMAP.md` "Owner desk and public site visual
redesign", `docs/DESIGN-SYSTEM.md`, `docs/brand/` (`03_Design_System/brand-tokens.json`), `docs/plans/overhaul/DESIGN.md`
§4–6, mockups in `docs/design-mockups/redesign-2026-10-04/` (layout and feel only; their text and numbers are
placeholders).

**This batch changes how screens look, never what they do.** No behaviour, permission, money, query or schema
change. Anything else noticed goes to `docs/ROADMAP.md`. Existing unit/integration tests must pass untouched; browser
tests may change selectors and visible text only, each change listed in the PR.

**For the implementing model (Sonnet 5.5 or Sol 5.6):** follow it literally. No third-party UI library code or assets
(component sites were inspiration only). No new colours, radii or font sizes outside the token files. Stop where it is
silent (section 5).

---

## 0. Verify before starting

| # | Fact | How to check |
|---|---|---|
| A1 | Batches B2, D and E are merged; STATUS says E2 is next. | `docs/STATUS.md` |
| A2 | E's token migration is done: no `gray-*`/`slate-*` utility in `src/**/*.tsx`, and the ESLint rule that forbids them is on. | `npm run lint`; grep |
| A3 | Colour tokens and their dark values live in `src/app/globals.css` (`:root` and `.dark`), exposed through `@theme inline` (incl. `focus-ring` after E). Dark mode is the `.dark` class on `<html>`, set by `src/lib/theme.ts` and `public/theme-init.js`, chosen by `ThemeToggle` (light / dark / system). | read files |
| A4 | Manrope is loaded once in `src/app/layout.tsx` (`next/font/google`) and mapped to `--font-display`/`--font-sans`. | file |
| A5 | Desk shell: `src/app/desk/layout.tsx` → `DeskSidebar` (`src/components/desk-sidebar.tsx`, client component; native `<dialog>` drawer on phones) with groups from `deskNavigation(role)` (`src/lib/desk-navigation.ts`). Desk primitives: `PageHeader`, `SectionCard`, `EmptyState`, `FilterBar`, `Metric`, `primaryActionClass`, `secondaryActionClass` (`src/components/desk/workspace.tsx`); `StatusBadge` (`src/components/status-badge.tsx`, tones success/pending/attention/stopped/progress); icons in `src/components/icons/{status-icons,service-icons}.tsx`. | read files |
| A6 | Portal shell: `src/app/account/layout.tsx` → `AuthedHeader` with `ACCOUNT_LINKS`. Public shell: `src/app/(public)/layout.tsx` with `src/components/site/{header,footer,container,button-link}.tsx`. | read files |
| A7 | Logos already in the app: `public/brand/{logo-light.svg,logo-dark.svg,mark.svg}`; appliance photos: `public/appliances/{washer,dryer,washer-dryer-set,hero-lineup}.jpg`. | ls |
| A8 | Brand kit values: radius control 8px, card 16px; spacing 4/8/12/16/24/32/48/64/96; colours evergreen #123C2D, fresh #B9E66B, ivory #F7F5EC, ink #17251E, sage #DCE7DF, muted #4E6658, night #0C1E16; dark surface #152E22, dark muted #B7C8BB, dark border #789985. | `docs/brand/03_Design_System/brand-tokens.json` |
| A9 | Today's data comes from `getExceptionOverview`, `getExceptions`, `getTodaysJobs` (`src/domains/exceptions/index.ts`) and the Today page's existing summaries; these already respect roles. | read `src/app/desk/today/page.tsx` |
| A10 | Browser groups `browser-a`…`browser-d` (+ any E added); E's `e2e/route-inventory.ts` lists every route. | `e2e/shards.json` |

## 1. Decisions

**E2-1. One shared component layer, built first; screens then only swap to it.** New components live in
`src/components/ui/` (section 3). No screen gets hand-styled one-off markup that duplicates a component. Reason: the
redesign must stay consistent across ~55 screens and be cheap to change later.

**E2-2. Tokens only. Three additions, all from the kit:** `--radius-control: 8px`, `--radius-card: 16px` (exposed as
Tailwind `rounded-control`/`rounded-card`), and two sidebar tokens `--color-nav-bg` (light: night #0C1E16; dark: night)
and `--color-nav-ink` (ivory #F7F5EC), plus `--color-nav-current-bg` = fresh, `--color-nav-current-ink` = evergreen.
The headline stat card's gradient is `linear-gradient(145deg, var(--color-primary), var(--color-nav-bg))` in light
and `linear-gradient(145deg, var(--color-surface), var(--color-nav-bg))` in dark; nothing else uses a gradient.
A lint guard (extend E's ESLint rule) fails on: hex colours, `rgb(`/`hsl(` in `className` or `style`, arbitrary
Tailwind values in brackets for colour/radius/spacing (`/\[(#|rgb|hsl|\d+px)/`), and `rounded-(sm|md|lg|xl|2xl|3xl)`.

**E2-3. Owner desk shell (approved direction).** Desktop (≥ 1024px): fixed dark evergreen side menu (nav tokens), the
Robinson mark + "Appliance Desk" at top, groups from `deskNavigation(role)` unchanged, the current page as a fresh-green
pill with evergreen text and `aria-current="page"`, search and theme switch at the bottom of the menu; ivory working
area (`bg-canvas`). Tablet (768–1023px): the menu collapses to icons + labels on hover/focus is **not** used (too
fiddly); it becomes the phone layout instead. Phone (< 1024px): top bar (mark, page title, search button) and a
**bottom tab bar** with Today, Schedule (→ `/desk/dispatch`), Customers, Billing, More (opens the existing drawer with
the full menu). STAFF sees Today, Schedule, Jobs, Inventory, More (no Billing — they have no finance access; the tab
list comes from the role-filtered `deskNavigation`, never hard-coded per role in the component). Every tap target ≥
44×44px; the bar respects `env(safe-area-inset-bottom)`.

**E2-4. Today screen (approved direction).** Top: page header with date and one dominant action ("New visit" for
OWNER/ADMIN; "My next visit" for STAFF). Stat row: one headline `StatCard` (gradient) for "Visits today" with the
breakdown line built from `getTodaysJobs` counts by type, then plain stat cards (open invoices count and amount for
OWNER/ADMIN only; items needing attention; open tasks). Then two columns on desktop / stacked on phone: "Today's
visits" (`VisitRow`: time, customer, address, type icon + word, status word + icon) and "Needs your attention"
(`AttentionList` from `getExceptions`, grouped by category, with the true totals from `getExceptionOverview`). Every
number comes from those existing functions; if a function does not return a number the mockup shows, the number is
left out (no new queries — section 5).

**E2-5. Tables become cards on a phone.** `DataList` renders a semantic `<table>` at ≥ 768px and a list of cards below,
from the same column definitions (`header`, `cell`, `primary?`, `hideOnPhone?`). Sorting/pagination behaviour is the
caller's, unchanged.

**E2-6. Customer portal: same look, phone first.** Header with logo and the existing links; on phones a bottom bar
with Home, Rentals, Maintenance, Billing, Account. The portal home keeps its four questions (what do I rent, what's
next, do I owe anything, how do I get help) as cards in that order, with "Report a problem" as the dominant action.

**E2-7. Public site: ivory in light mode, evergreen in dark mode (Chris, 2026-10-04, IN-32).** One home page that
follows the visitor's theme (the same `.dark` switch and theme toggle as the rest of the app; the device setting is
the default). **Light:** ivory hero (`bg-canvas`), evergreen headline, the `hero-lineup.jpg` photo beside it on desktop
(below on phones), one dominant "Check your address" button in evergreen with ivory text, and "See prices" as a text
link. **Dark:** the same layout on night/evergreen (`bg-canvas` and `bg-surface` in dark are the kit's night and dark
surface), ivory text, the fresh-green button with evergreen text, the photo framed by a `border-line` edge so it does
not float. Both keep exactly one dominant action — the kit's rule — so neither mode needs a contrast exception, and
no second gradient is introduced. All text comes from D's site-content fields and Settings; prices from the catalog.
The other public pages use the same light/dark treatment through the shared components without a layout change.

**E2-8. Real assets only.** Logos from `public/brand/` (light/dark variants switched with the theme); appliance photos
from `public/appliances/` with existing alt text (D's site-content alt fields on public pages) and explicit
`width`/`height` (Next `Image`); where a photo is missing, a sage panel with the service icon is used. No new
photography, no illustrations from outside the kit.

**E2-9. Accessibility is measured, not assumed.** axe on every route at 360, 390, 768 and 1440 px in light and dark
(E's generated spec, extended with the two extra widths for desk Today, portal home and public home only — the rest
stay at 360/1440 to protect CI time); a hand contrast table (`docs/ACCESSIBILITY.md` section "Colour pairs") listing
every text/background pair the components use with its measured ratio (WCAG formula, computed by a small test,
`tests/contrast-pairs.test.ts`, from the token values — so a token change re-checks itself); focus visible on every
control (2px `ring-focus-ring` with 2px offset); status never by colour alone; reduced motion; forced colours; 200%
zoom and 320px reflow without sideways scroll.

**E2-10. Print and email keep working.** Printable pages (`work-order`, invoice/statement print views, D's document
artifacts) and branded emails are untouched except for using the new logo files; print styles hide the side menu and
bottom bars.

## 2. Schema changes
None.

## 3. Shared components (`src/components/ui/`, new; each with a unit test rendering it in light and dark)

| Component | Props (TypeScript) | Notes |
|---|---|---|
| `AppShell` | `{ nav: DeskNavGroup[]; role: string; children }` | Desk shell (E2-3); replaces `DeskSidebar` usage in `desk/layout.tsx`; keeps the existing drawer's focus handling |
| `BottomTabBar` | `{ tabs: Array<{ href: string; label: string; icon: ComponentType<{ className?: string }> }>; activeHref: string }` | phones only; `nav` landmark labelled "Main"; icons from `src/components/icons/service-icons.tsx` (add any missing one there, same stroke style) |
| `PageHeader` | existing props + `primaryAction?: { href: string; label: string }` | upgrade in place in `desk/workspace.tsx` (re-export from `ui/`) |
| `Card` | `{ title?: string; description?: string; actions?: ReactNode; children }` | 16px radius, `bg-surface`, `border-line` |
| `StatCard` | `{ label: string; value: string; detail?: string; href?: string; tone?: "headline" \| "plain" }` | headline = gradient (E2-2); value already formatted by the caller |
| `StatusPill` | `{ tone: StatusTone; label: string }` | wraps `StatusBadge`; always icon + word |
| `VisitRow` | `{ time: string; customer: string; address: string; type: JobType; status: JobStatus; href: string }` | uses existing label helpers |
| `AttentionList` | `{ groups: Array<{ category: string; title: string; total: number; items: ExceptionItem[] }> }` | "and N more" when truncated |
| `DataList<T>` | `{ rows: T[]; columns: Column<T>[]; caption: string; empty: ReactNode }` | E2-5 |
| `Field`, `Select`, `Textarea`, `Checkbox` | label, help, error, all native props | 8px radius; 44px min height; error text linked by `aria-describedby` |
| `Button`, `ButtonLink` | `{ variant: "primary" \| "secondary" \| "quiet" \| "danger"; size?: "md" \| "lg" }` | replaces `primaryActionClass`/`secondaryActionClass` (keep those as thin aliases until the last screen moves, then delete) |
| `EmptyState` | existing | restyle in place |

## 4. Work units (PR stack; each PR ships screens fully moved, never half a screen)

### WU-E2-1 — Tokens, guards, contrast test, shared components (PR 1)
Files: `src/app/globals.css` (E2-2 tokens), `eslint.config.mjs` (guard), `src/components/ui/*` + tests,
`tests/contrast-pairs.test.ts`, `docs/ACCESSIBILITY.md` (colour pairs table), `docs/DESIGN-SYSTEM.md` (component list).
Done when: components render in a test page that is **not** routed in production (put examples in the unit tests
only), lint passes, every listed pair ≥ 4.5:1 for text and ≥ 3:1 for large text/UI parts.

### WU-E2-2 — Desk shell and Today (PR 2)
Files: `src/app/desk/layout.tsx`, `AppShell`, `BottomTabBar`, `src/app/desk/today/**`. Browser: extend
`e2e/desk-workspace.spec.ts` (phone: tab bar visible, More opens the drawer, keyboard reaches every tab; desktop: current
page pill has `aria-current`). Screenshots light/dark × 360/390/768/1440 attached to the PR.
**Chris checks the phone owner desk on the preview before this PR merges** (PLAN acceptance line).

### WU-E2-3 — Desk work screens (PR 3): customers, leads, estimates, agreements, jobs, dispatch, driver, maintenance, tasks, search
### WU-E2-4 — Desk inventory and money screens (PR 4): inventory, parts, suppliers, purchase orders, fleet, billing (all tabs), reconciliation, held payments, revenue, reports, growth, notices, automations, activity
### WU-E2-5 — Settings and launch screens (PR 5): every settings section, website editor, launch, privacy desk
For WU-E2-3…5, per screen: replace markup with `ui/` components; tables → `DataList`; forms → `Field` family; no data
or action change. Each PR lists every browser-test selector or text it changed.

### WU-E2-6 — Customer portal (PR 6)
Files: `src/app/account/**`, portal bottom bar. Browser: extend `e2e/accessibility-authenticated.spec.ts`.

### WU-E2-7 — Public site (PR 7)
Build the home page per E2-7 in both modes, then move the other public pages to the shared components. Screenshots of
the home page in light and dark at 390 and 1440 go in the PR. **Chris sees the real home page on the preview, in both
modes, before this PR merges.**

### WU-E2-8 — Print, email, cleanup, docs (PR 8)
Print styles (E2-10); delete `primaryActionClass`/`secondaryActionClass` aliases and the old `DeskSidebar` once unused
(`grep` proves it); `docs/OWNER-GUIDE.md` screenshots refreshed (F re-takes them later); `docs/STATUS.md`;
`docs/designs/CHANGES-SINCE-DESIGN.md` (screen names/selectors F must use).

CI budget: no new browser group. Screenshots for the PR are produced by a local run (PLAYBOOK 4c recipe), not by CI.
The extra widths in E2-9 apply to three routes only.

## 5. Stop-and-ask
1. Any section 0 row is false (especially A1/A2: E not merged).
2. A screen needs a number, list or action that no existing function provides (would be a behaviour change).
3. A colour pair fails contrast and no existing token fixes it.
4. A change to the home-page direction in E2-7 (light ivory, dark evergreen, one dominant action).
5. A browser test would need a change beyond selectors/visible text.

## 6. Acceptance mapping
| PLAN E2 line | Evidence |
|---|---|
| No behaviour/permission/number changes | unit/integration suites untouched and green; selector-change list in each PR |
| Light/dark × phone/desktop screenshots for every top-level route | PR attachments (local run) |
| axe on every route, contrast values recorded | E's generated spec; `tests/contrast-pairs.test.ts`; `docs/ACCESSIBILITY.md` |
| Keyboard, focus, zoom, reflow, forced colours, reduced motion | WU-E2-2/6 browser checks + manual checklist in the PR |
| No hard-coded colours/radii/sizes | E2-2 lint guard |
| No sample data or `[BRACKETS]` | `grep -rn "\[[A-Z][A-Za-z ]*\]" src` returns nothing user-facing |
| CI within budget | no new group; durations in the CI notice |
| Chris saw the home page (both modes) and the phone desk before their PRs merged | PR comments |

## Amendments
(Dated entries only.)
