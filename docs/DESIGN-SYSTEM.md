# Design system & accessibility rules

> Current brand correction (2026-09-30): Evergreen v2.0, implemented in
> `src/app/globals.css`, superseded the navy/teal palette and placeholder
> wordmark described in historical sections below. Keep the real brand assets.
> The proposed UI/UX overhaul is specified in `plans/overhaul/DESIGN.md`;
> its implementation has not started. Existing accessibility rules still apply.

Kept intentionally simple for Phase 1: Tailwind CSS utility classes,
no separate component library beyond what's needed (shadcn/ui components
get added as later phases need specific UI, e.g. a data table for
`/desk/inventory`).

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
than logging in per test. Routes that require a generated or single...[truncated]