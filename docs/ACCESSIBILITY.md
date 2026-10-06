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

- `/estimate/[id]` — requires a real public estimate link.
- `/launch/confirm/[token]` — token is single-use and expires.
- `/sign/[id]` — requires a generated agreement in a signable state.
- `/account/billing/invoice/[invoiceId]` — the CI customer invoice id is generated per run.
- `/desk/agreements/[id]` and `/desk/agreements/[id]/early-return` — require generated agreement state/eligibility.
- `/desk/billing/customer/[id]` and its invoice route — require generated customer/invoice ids.
- `/desk/billing/deposits/[id]` — requires a specific deposit-liability record.
- `/desk/customers/[id]` — generated customer id.
- `/desk/estimates/[id]` — generated estimate id.
- `/desk/leads/[id]` — generated lead id.
- `/desk/maintenance/[id]` — generated maintenance-request id.
- `/desk/notices/[id]/resolve` — requires a live unresolved notice and mutates its state.
- `/desk/parts/[id]` — generated part id.
- `/desk/purchase-orders/[id]` — generated purchase-order id and lifecycle state.
- `/desk/suppliers/[id]` — generated supplier id.

The deterministic CI fixtures **are** used for `/scan/CI-SECURITY-UNIT`,
`/desk/inventory/ci-security-appliance`, and `/desk/jobs/ci-security-job` (including their QR/work-order routes).

## What automation does not prove

Before launch, manual accessibility review still covers:

- screen-reader reading order, landmarks, names, descriptions, and announcements;
- full keyboard-only workflows, including dialogs, validation recovery, and destructive confirmations;
- 200% and 400% zoom/reflow and text spacing;
- touch target size and mobile ergonomics;
- meaning, clarity, cognitive load, and whether instructions make sense without visual context;
- focus order after async updates and route changes;
- real forced-colors/high-contrast behavior on supported operating systems;
- real assistive-technology behavior for document/signing/payment flows.

Record any manual finding as a normal product defect; do not describe the product as “WCAG certified.”


## Batch E2 contrast foundation

Batch E2 reuses the final Batch E Evergreen palette. `tests/contrast-pairs.test.ts` calculates WCAG contrast directly from `src/app/globals.css` for both light and dark token sets. Text pairs are required to be at least 4.5:1; focus/control UI pairs are required to be at least 3:1.

Measured representative pairs on the E2-1A baseline:

| Pair | Ratio |
| --- | ---: |
| Light ink on ivory canvas | 14.57:1 |
| Light muted text on ivory canvas | 5.71:1 |
| White on evergreen action | 12.28:1 |
| Ivory on night navigation | 15.85:1 |
| Evergreen on fresh current-navigation | 8.53:1 |
| Dark ivory text on dark surface | 13.30:1 |
| Dark muted text on dark surface | 8.29:1 |
| Dark evergreen text on fresh action | 8.53:1 |
| Light control border on white surface | 6.24:1 |
| Dark control border on dark surface | 4.63:1 |

The automated test is a regression guard, not a WCAG certification. Route-level axe and the existing manual-only checks still apply.
