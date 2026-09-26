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
axe against every page as it's built, tagged `wcag2a`/`wcag2aa`/
`wcag21a`/`wcag21aa`, and fails the build on any violation. This catches
missing labels/contrast/etc. automatically — it does **not** replace a
manual screen-reader + keyboard pass before launch (tracked in
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
