# Accessibility engineering checks

Appliance Desk targets **WCAG 2.2 AA as an engineering standard**. This is not a certification claim.

## Automated route coverage

`e2e/route-inventory.ts` is the authoritative list of App Router pages. A unit test compares it to every
`src/app/**/page.tsx` file so a newly added route cannot silently escape the inventory.

Automated routes run through axe at **360 px and 1440 px**, in **light and dark mode**, with reduced motion enabled.
The generated browser specs are split across the existing browser shards to keep CI parallel rather than creating a
fifth runner.

Axe checks include WCAG 2 A/AA, 2.1 AA, and 2.2 AA rule tags supported by the installed axe-core version. Passing axe
does **not** prove complete WCAG conformance.

## Manual-only routes

These routes remain in the inventory but are excluded from generated axe runs because their safe fixture is inherently
stateful or generated per run:

- `/estimate/[id]` â€” requires a real public estimate link.
- `/launch/confirm/[token]` â€” token is single-use and expires.
- `/sign/[id]` â€” requires a generated agreement in a signable state.
- `/account/billing/invoice/[invoiceId]` â€” the CI customer invoice id is generated per run.
- `/desk/agreements/[id]` and `/desk/agreements/[id]/early-return` â€” require generated agreement state/eligibility.
- `/desk/billing/customer/[id]` and its invoice route â€” require generated customer/invoice ids.
- `/desk/billing/deposits/[id]` â€” requires¶»§q«^