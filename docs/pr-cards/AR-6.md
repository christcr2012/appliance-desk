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
