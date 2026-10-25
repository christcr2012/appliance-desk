# Design system & accessibility rules

> Current brand correction (2026-09-30): Evergreen v2.0, implemented in
> `src/app/globals.css`, superseded the navy/teal palette and placeholder
> wordmark described in historical sections below. Keep the real brand assets.
> The UI/UX overhaul and Batch E2 shared visual layer are implemented through
> PR #263. `plans/overhaul/DESIGN.md` remains design history/reference; current
> shared primitives live in `src/components/ui/`. Existing accessibility rules
> remain mandatory. The public-site implementation is technically complete but
> its overall visual quality is explicitly deferred for a stronger later pass.

The app uses Tailwind CSS plus the repository's own shared UI primitives; no
third-party component library is required for the current design system.

## Accessibility — required, not optional (WCAG 2.2 AA)

Applies to the public site, the customer portal, and the owner desk
alike:

- Sufficient color contrast (verify with axe / browser devtools, not by
  eye).
- Full keyboard navigation with a visible focus ring (never
  `outline: none` without a replacement focus style).
- A `<label>` (or `aria-label`) on every form field and button — never
  a placeholder alone.
- Error messages tied to their field via `aria-describedby` /
  `aria-invalid`, and announced with `role="alert"`.
- `alt` text on every image, with an alt-text input field wherever Chris
  uploads an image himself (appliance condition photos, job photos,
  maintenance photos, logo).
- Proper heading order (one `<h1>` per page, no skipped levels).
- Never convey information by color alone (e.g. a status badge needs
  text, not just a colored dot).
- Respect `prefers-reduced-motion`.
- Usable at 200% browser zoom and on phones.

**Automated checks are wired into CI**. `e2e/route-inventory.ts`
is the authoritative page inventory, and the generated
`e2e/accessibility-routes-*.spec.ts` suites run axe at 360 px and
1440 px in both light and dark mode for every route with a deterministic
fixture. CI's isolated OWNER/CUSTOMER/STAFF sessions are reused rather
than logging in per test. Routes that require a generated or single-use
record/token remain in the inventory with a written manual-only reason;
`tests/accessibility-route-inventory.test.ts` fails if any App Router
page is missing. The focused legacy accessibility specs remain useful
regression tests for keyboard/menu/theme behavior. See
`docs/ACCESSIBILITY.md` for the coverage boundary and manual checks.
Automated checks are engineering evidence, **not WCAG certification**.

An `/accessibility` statement page with a way to report problems is
required before launch (Phase 2/7).

## Conventions

- Server Components by default; a component only becomes a Client
  Component (`"use client"`) when it truly needs interactivity (forms,
  the login form, anything with `useState`/event handlers).
- Business logic lives under `src/domains/<domain>/`, not inside page
  components — pages call into domain functions, they don't contain
  pricing/scoring/status logic themselves.
- `/desk/**` and `/account/**` are marked `noindex, nofollow` (see
  `next.config.ts`) — they should never appear in search results.

### Application structure (Chris, 2026-10-25)

The desk is an application, not a set of category pages. Five areas (Today, Customers, Schedule, Equipment, Money),
Settings in the profile menu, and four page types only: work queue, record page, guided flow, settings page — each
built from the shared kit in `src/components/ui`. Full rules and the page map: [designs/APP-REDESIGN.md](designs/APP-REDESIGN.md).

### Quiet screens (Chris, 2026-10-25)

Screens explain themselves through layout, labels and status, not paragraphs. At most one short line under a page
title (often none). Help, definitions and "why" go behind an ⓘ (`src/components/ui/info-tip.tsx`, text in
`src/lib/glossary.ts`). Empty states are one line plus one button. Filters live in one place (tabs with counts plus a
single Filter sheet), never in several permanent rows of chips. A page should look like professional business
software, not a web page of instructions. See [designs/LEADS-WORKSPACE.md](designs/LEADS-WORKSPACE.md) section 3.

### No bare link lists (Chris, 2026-10-25)

Desk pages must look and behave like an application, not an informational website. Never put rows of underlined
navigation links on a page. Sibling pages of one feature use a **tab bar**; places to go use **task cards** (short
title, a live status badge, an ⓘ saying what it is for and when you would use it, one large tap target);
actions use **buttons** on the To do item or record they belong to. Inline links are allowed only inside a sentence
that already explains them. See [designs/BOOKS-AUTOPILOT.md](designs/BOOKS-AUTOPILOT.md) principle 7 and BA-6.

### Status badges (added 2026-09-29)

Every status shown anywhere in the app — a lead's stage, an estimate's
state, a job's status, an invoice's status, a purchase order's status,
active/removed for a staff account, and so on — reduces to one of
**five tones**: `success`, `pending`, `attention`, `stopped`,
`progress`. Use the shared `<StatusBadge tone label variant />`
component (`src/components/status-badge.tsx`) rather than hand-rolling
a new `Record<Status, string>` color map — that's exactly the
copy-paste pattern this component replaced across ~8 files. Each tone
pairs a text color with one of the five icons in
`src/components/icons/status-icons.tsx`, so status is never carried by
color alone (see the color-alone rule above). `variant="text"` for an
inline status next to other text; `variant="pill"` for a standalone
badge. `src/lib/status-labels.ts` holds the actual
status-enum-to-tone/label mapping for each domain (`invoiceStatusTone`,
`jobStatusTone`, `rentalAgreementStatusTone`, etc.) — add a new
status's tone there, not inline in a page.

If you add a brand-new color combination for a badge (e.g. a tone that
needs `bg-blue-100`/`text-blue-700` and only `bg-blue-50`/
`text-blue-900` had a `.dark` override before), add the matching
dark-mode override too — see "Dark mode" below. This is exactly the
kind of gap the 2026-09-29 icon-set work found and fixed for
`bg-blue-100`/`text-blue-700`/`text-blue-800`.

## Historical brand palette: navy/teal (superseded by Evergreen v2.0)

The brand colors themselves changed from the original warm terracotta
palette to a navy/teal one — see `docs/DECISIONS.md` for the full
story. Short version: Chris commissioned a second, independent design
review (OpenAI's "Astra" — `docs/reviews/2026-09-28-astra-redesign-
brief.md`) that proposed a navy/teal palette; he asked to see it for
real before deciding, so it was built as a real preview deployment
(PR #41, kept CI-clean the whole time) rather than a mockup; he looked
at it side by side with the old palette on production and approved it.
The actual color values live only in `src/app/globals.css`'s `:root`
and `.dark` blocks as CSS variables (`--color-primary`, `--color-ink`,
etc.) — nothing else in the app hard-codes a specific hex value, so a
future palette change (if Chris ever wants one) is the same kind of
token swap, not a rewrite.

Historical status from that brief: the real logo was then unbuilt. This is
now superseded by `public/brand/logo-light.svg`, `logo-dark.svg` and `mark.svg`.
The remaining overhaul scope includes
and everything in it beyond colors (owner-desk information
architecture, customer-portal rebuild, new business-line UI) — see
`docs/ROADMAP.md`.

## Brand consistency, desk/portal/sign-in pages (added 2026-09-27)

Following a design review, the owner desk, customer portal, and
sign/login/reset-password pages' plain, unbranded Tailwind classes
(`bg-white`, `text-gray-900`, `bg-gray-900` buttons, `bg-blue-700`) are
retinted to the same brand palette the public site uses — same
technique as the dark-mode override block just below it in
`globals.css` (retint the class, once, globally, rather than touching
every one of the ~50 files that use it). Semantic status colors
(green/red/amber "success/error/warning", the one blue "info" box)
are deliberately untouched — they carry meaning, not brand identity.

**One exception, and why:** `bg-gray-900` (every primary-action button
in the app) retints to the brand's primary color in light mode, but is
explicitly given its own fixed dark color in `.dark` rather than the
brand primary variable — in dark mode the brand's primary color is
light and saturated (meant to be used as *text* on a dark background,
or in the navy/teal palette specifically, under dark text of its own),
and using it as a button fill under the plain white text every button
in this app hardcodes measured well under WCAG's 4.5:1 when this was
first caught (an orange, ~2.6:1 at the time; the same risk applies to
any future light/saturated primary color, teal included). If you add a
new `.dark` rule near this one, check actual contrast before assuming
a "brand color everywhere" instinct is safe — light-mode and dark-mode
variants of the same token are not interchangeable the way they look
in the CSS variable list.

The owner desk's desktop navigation also changed from a row of plain
text links (11 of them — Chris's own description: "it's just word
links sitting on the pages") to a real sidebar with an active-page
indicator (now `src/components/ui/app-shell.tsx` with `src/components/ui/bottom-tab-bar.tsx` on phones, from Batch E2). The customer portal
(4 links) keeps its original top-nav row, now with the same
active-page indicator added to `AuthedHeader` itself. See
`AuthedHeader`'s `variant` prop for how the two share the same
underlying mobile menu.

## Dark mode (added 2026-09-27)

Switched by a `.dark` class on `<html>` (not just the device's own
setting) — `src/lib/theme.ts`, toggled by the sun/moon button in every
header. Defaults to the device's setting the first time, then
remembers whatever the person last chose.

**If you're adding a new page or component, you don't need to do
anything special for it to support dark mode**, as long as you stick to
the patterns already in use:

- The public site's components are built from the CSS variables in
  `globals.css` (`bg-canvas`, `text-ink`, `bg-surface`, etc.) — those
  already have both a light and a dark value, so anything built from
  them adapts automatically.
- The owner desk, customer portal, and sign/login pages use plain
  Tailwind colors instead (`bg-white`, `text-gray-900`,
  `border-gray-200`, and so on) — `globals.css` has a block of `.dark`
  overrides for the exact set of these classes already in use
  throughout the app, so reusing one of them also adapts automatically.
  A button's own colors (e.g. `bg-gray-900 ... text-white`) are
  deliberately NOT overridden — a dark button with white text already
  reads fine in either theme.

**If you introduce a hard-coded color class that isn't already on that
override list** (a new shade, e.g. `bg-purple-50`), it will look right
in light mode but won't adapt in dark mode until a matching `.dark
.bg-purple-50 { ... }` rule is added next to the others in
`globals.css`. Batch E/E2 replaced the old representative-only boundary with
the generated route inventory: every current top-level route is assigned to the
light/dark accessibility suites at the documented CI widths, with explicit
manual-only reasons only where deterministic automation is impossible. Focused
legacy dark-mode specs remain additional regression coverage.



### Signature layer (V-1, 2026-10-17)

All values live in `src/app/globals.css`; pages use the names, never raw numbers.
- **Type scale:** `text-display` (hero), `text-h2`, `text-h3`, `text-lede`, `text-eyebrow`, `text-price`; each carries its own line height, letter spacing and weight. Headings use balanced wrapping.
- **Colours:** `hairline` (thin rules, a mix of the strong line and canvas) and `tint` (the offset panel behind the hero photo). Both are mixes of existing tokens, and `tests/theme-contrast.test.ts` checks the text pairs on them at 4.5:1.
- **Cut corners:** `cut-corner-sm` (buttons), `cut-corner-md` (cards), `cut-corner-photo`, `cut-band` (full-width bands). The clip is removed while an element or something inside it has keyboard focus, so the focus ring is never cut off.
- **Highlight:** a fresh-green band behind part of a heading (lower 38% in light mode; solid with on-accent text in dark mode).
- **Shadow:** one raised shadow, `shadow-raise`, light and dark values.
- **Motion:** `signature-rise` (12px, 320ms) and `signature-lift`; both switch off under reduced motion.
- **Ledger rows** (hairline-separated lists) replace boxed benefit cards; numbered steps use CSS counters so numerals are not page words.

### Signature layer, inner pages and the desk (V-3, V-4, 2026-10-17)

- **Page hero** (`src/components/site/page-hero.tsx`): the full-width evergreen cut band that opens pricing, how it works, service area, contact, launch and the city pages (dark surface in dark mode). It holds the page's one h1 at the display size and an optional lede or eyebrow, and adds no words of its own. The legal pages keep their fixed text and are not restyled.
- **Featured price card:** the first published set is the evergreen cut card on pricing as on the home page; other appliances are plain cards; fees and "good to know" are hairline ledgers.
- **Day timeline** (`src/components/ui/day-timeline.tsx`, Today, wide screens only): visits placed by scheduled time on an 8 am to 7 pm axis, each as long as its own recorded length, else the default job length in Settings (owner approved the extra read 2026-10-17; one hour if neither is given), overlapping visits side by side, a Now marker, and words Done / In progress / Next / the time. Visits with no time or outside the axis are listed beneath it; phones keep the VisitRow list. 
- **Severity:** attention items show a stripe and a word, Urgent (high) or Soon (medium), from the existing severity; never colour alone.
- **Money tiles** show an Actual or Estimate tag from the METRICS kind.
- **Search shortcut:** the one desk search box says "Search or jump to…", shows its key (Cmd K or Ctrl K) and the key focuses it; there is no other search.
- **Portal home:** the "How do I get help?" card is the evergreen cut card with the fresh Report a problem button.

### Batch E2 visual tokens

E2 extends the final Batch E Evergreen tokens with brand-kit-only visual primitives: `rounded-control` = 8px, `rounded-card` = 16px, and semantic owner-navigation colors (`nav-bg`, `nav-ink`, `nav-current-bg`, `nav-current-ink`). Values remain defined only in `src/app/globals.css` and are exported through Tailwind's `@theme inline` block.

E2-1A initially scoped the hard-coded color/arbitrary-pixel/legacy-radius guard to `src/components/ui/**/*.tsx` while screens migrated. E2-8 completes the planned cleanup and broadens the guard to the finished TSX surface.
