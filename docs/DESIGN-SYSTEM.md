# Design system & accessibility rules

Kept intentionally simple for Phase 1: Tailwind CSS utility classes,
no separate component library beyond what's needed (shadcn/ui components
get added as later phases need specific UI, e.g. a data table for
`/desk/inventory`).

## Accessibility — required, not optional (WCAG 2.1 AA)

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

**Automated checks are wired into CI**: `e2e/accessibility.spec.ts` runs
axe against the public site and the login/password pages, tagged
`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`, and fails the build on any
violation. `e2e/accessibility-authenticated.spec.ts` (added 2026-09-27)
does the same for every page behind a login — the owner desk
(`/desk/**`) and the customer portal (`/account/**`) — by logging in for
real as a test-only OWNER/CUSTOMER account that `prisma/seed.ts` creates
when `OWNER_EMAIL`/`OWNER_PASSWORD`/`TEST_CUSTOMER_EMAIL`/
`TEST_CUSTOMER_PASSWORD` are set (CI sets these against its own
throwaway database only — see `.github/workflows/ci.yml`; never set
them against production). Together these catch missing labels/
contrast/etc. automatically across the entire app — they do **not**
replace a manual screen-reader + keyboard pass before launch (tracked in
`docs/ROADMAP.md`, Phase 7).

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

## Brand consistency, desk/portal/sign-in pages (added 2026-09-27)

Following a design review, the owner desk, customer portal, and
sign/login/reset-password pages' plain, unbranded Tailwind classes
(`bg-white`, `text-gray-900`, `bg-gray-900` buttons, `bg-blue-700`) are
now retinted to the same warm brand palette the public site always
used — same technique as the dark-mode override block just below it in
`globals.css` (retint the class, once, globally, rather than touching
every one of the ~50 files that use it). Semantic status colors
(green/red/amber "success/error/warning", the one blue "info" box)
are deliberately untouched — they carry meaning, not brand identity.

**One exception, and why:** `bg-gray-900` (every primary-action button
in the app) retints to the brand's primary color in light mode, but is
explicitly restored to its original near-black in `.dark` — the
brand's primary color in dark mode is a light, saturated orange meant
to be used as *text* on a dark background, and using it as a button
fill under white text measured well under WCAG's 4.5:1 (about 2.6:1).
If you add a new `.dark` rule near this one, check actual contrast
before assuming a "brand color everywhere" instinct is safe — light-
mode and dark-mode variants of the same token are not interchangeable
the way they look in the CSS variable list.

The owner desk's desktop navigation also changed from a row of plain
text links (11 of them — Chris's own description: "it's just word
links sitting on the pages") to a real sidebar with an active-page
indicator (`src/components/desk-sidebar.tsx`). The customer portal
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
`globals.css`. `e2e/accessibility-dark-mode.spec.ts` runs the same axe
checks as the light-mode suite with the browser set to dark, on a
representative sample of pages (not literally every page) — it's the
first line of defense for something like this, but isn't a substitute
for checking a new page in dark mode yourself if it's not one of the
ones that suite covers.
