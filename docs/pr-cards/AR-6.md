# AR-6 — Equipment area: fleet, appliance record, purchases and orders, parts, suppliers, retired

Build spec: `docs/build-specs/screens/EQUIPMENT.md` (everything is decided there). Design: `docs/designs/APP-REDESIGN.md`
4.1, 4.2, 4C, 7. Approved by Chris 2026-10-25. Depends on **AR-0**, **AR-1**, **AR-12** (built-in views, searchable
picker). Risk: **role checks on inventory and purchasing reads; staff no longer see part prices/costs; Retired can
no longer be set by the plain status change**. No migration. The `/desk/fleet` value report moves in AR-9.

## Why
Equipment is spread over seven pages. Several read functions have no role check of their own, staff can see part
costs and get forms that always fail, Retired can be set without a reason, a purchase's total is added up in the
page, and some lists load everything (all customers, all orders) or page unreliably.

## One PR
The fleet list, appliance record and the purchasing lists share the new words, pills and role-checked reads; the
fixes touch the same functions. Expected size is reviewable (mostly page restyles over existing actions). If the
diff passes ~1,500 changed lines, split Purchases/Parts/Suppliers into AR-6b and write the reason in the PR.

## Acceptance
- [ ] Every fix in spec section 1 is done, each with a test (role checks, staff parts DTO, retire guard, purchase
      total in the domain, Denver dates and plain status words, bounded reads, stable cursor order).
- [ ] Fleet tabs, search by appliance number/serial/model, bulk status change with allowed statuses only.
- [ ] Appliance record: header, stat strip, next step, status-based primary action, retire behind a confirmation
      with a reason, tabs; staff see the operational view only.
- [ ] Purchases with the Parts orders view; `/desk/purchase-orders` redirects; Parts and Suppliers cursor lists.
- [ ] Retired tab restyled with counts and bulk "Mark done".
- [ ] Axe, five sizes, light/dark, keyboard; pages added to `migrated-pages.json`.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Read EQUIPMENT section 1, then inspect `src/domains/inventory/index.ts`,
   `src/domains/purchasing/index.ts`, `src/domains/purchasing/purchases.ts`, and their actual callers/fakes.
   Make one acceptance→function→test table for the eight listed fixes before restyling pages.
2. First deliver role-filtered DTOs, the Retired refusal and stable `(createdAt,id)` cursor. With OWNER, ADMIN,
   STAFF and CUSTOMER fixtures, assert protected money keys are absent from staff results, not merely hidden
   in JSX. A single or bulk attempt to set RETIRED must leave status/custody unchanged; the dedicated retire
   action still requires its reason. Keep any current accountant access where approved by ACCT-1.
3. Build fleet/record over those reads and existing actions; then purchases/parts/suppliers per sections 5–7.
   Prove the receipt total equals the existing stored cents fields; keep arithmetic out of pages. Same-time
   fixtures must appear once each across cursor pages and counts must match the filtered population.
4. Use the current kit SearchablePicker export for customer/part lookup, not get-all reads; check its real
   caller/result shape before writing an adapter. Parallelize only independent record reads.
5. Reuse current inventory/purchasing suites and add the spec’s missing refusal/cursor/DTO regressions. Keep
   the card’s split rationale if purchasing merits AR-6b; do not block fleet completion on that separate UI.
