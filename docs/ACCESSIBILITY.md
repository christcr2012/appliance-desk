# Accessibility engineering checks

Appliance Desk targets **WCAG 2.2 AA** as an engineering requirement. This is not a certification claim.

## Automated route coverage

`e2e/route-inventory.ts` lists every `src/app/**/page.tsx` route. A unit test fails if the two lists drift.
Automated routes are scanned with axe at **360px and 1440px**, in **light and dark mode**, using the same
test-only OWNER and CUSTOMER sessions used elsewhere in CI. The four visual contexts for each route run in
parallel to keep browser-wall time bounded.

The generated route suites supplement the focused keyboard, mobile-menu, theme-toggle, security, and workflow
browser tests already in the repository. Axe catches many structural, labeling, and contrast problems; it does
not prove screen-reader usability, logical reading order, meaningful copy, keyboard workflow quality, zoom/reflow,
or accessibility of every transient state.

## Manual-only routes

These routes remain in the authoritative inventory but are not automatically navigated because the default CI
seed does not provide the safe state they require:

- `/estimate/[id]` — needs a disposable customer-specific estimate.
- `/sign/[id]` — needs an unsigned agreement; the standard CI agreement is already active.
- `/desk/billing/deposits/[id]` — needs a real deposit-liability record.
- `/desk/estimates/[id]` — needs a disposable estimate.
- `/desk/leads/[id]` — needs a lead with realistic contact history.
- `/desk/maintenance/[id]` — needs a standalone maintenance-request record.
- `/desk/notices/[id]/resolve` — needs a waiting/uncertain legal notice and must not mutate the shared seed.
- `/desk/parts/[id]` — needs a stable part record.
- `/desk/purchase-orders/[id]` — needs a disposable purchase order.
- `/desk/suppliers/[id]` — needs a stable supplier record.

Before release, exercise each manual-only route with representative disposable data in light/dark mode at phone
and desktop widths, keyboard through the primary workflow, inspect focus visibility and error/status announcements,
and run axe on the populated state.

## What still requires human review

Before launch, perform keyboard-only navigation, screen-reader checks on the primary public/customer/desk workflows,
200% zoom/reflow, forced-colors/high-contrast review, reduced-motion review, and confirm that status or meaning is
never conveyed by color alone. Record defects as normal product issues; do not describe the product as
“accessible-certified” or “WCAG certified.”
