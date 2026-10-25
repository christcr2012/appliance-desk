# AR-3 — Money area: Overview, Payments, the bill record and payment sheets

Design: `docs/designs/APP-REDESIGN.md` section 6. Build spec: `docs/build-specs/screens/MONEY-AREA.md` (everything is
decided there); the Bills list is already built (AR-0, `MONEY-BILLS.md`). Depends on **AR-0b**, **AR-1**, **AR-11**.
Risk: **money screens** — no money rule changes; every money button is an existing server action with its existing
confirmation. Read `docs/AI-PR-READ-FIRST.md` and say in the PR how each applicable item is honored.

## Why
Money is spread across seven places and Billing mixes different things behind chips. Chris gets one Money area:
an Overview that says how the month is going and what needs a decision, one list of payments, and a bill page whose
buttons fit the bill's status.

## Steps (in order)
1. Read-only data: `money-overview.ts` (+ `failedPaymentsWhere` extraction), `payment-tabs.ts`, `payments-list.ts`,
   `bill-timeline.ts`, with their tests (MONEY-AREA 1–3, 6).
2. `/desk/money` Overview page (+ `loading.tsx`, `error.tsx`); update `DESK_AREAS` (overview → `/desk/money`).
3. `/desk/payments` page; redirects from `/desk/billing?view=deposits|waiting`; update `DESK_AREAS` payments tab.
4. `TakePaymentSheet` and `RecordPaymentSheet` client wrappers (MONEY-AREA 4); use them on the Bills list, the
   customer record and the bill record.
5. Bill record redesign (MONEY-AREA 3) with `tests/bill-actions.test.ts`.
6. Add the three pages to `docs/build-specs/migrated-pages.json`; browser spec `e2e/money-area.spec.ts` in a shard;
   STATUS; card Progress.

## Acceptance
- [ ] Overview numbers match the existing revenue dashboard where they overlap (integration test).
- [ ] Payments lists received, failed and held payments correctly for both stored spellings; deposits and waiting
      views render the existing components; old billing view links redirect.
- [ ] The bill record shows the right primary action for each status (unit table) and every money action is the
      existing component/action with its own confirmation (diff review + spies).
- [ ] Take payment and Record cash or check open in place from the Bills list, customer record and bill record.
- [ ] OWNER/ADMIN only everywhere; staff refused (browser spec).
- [ ] Axe + 5 sizes; `ci` green at the exact head; every review comment read.

## Not in this card
The "Being confirmed" tabs on Bills and Payments (BILL-1 adds them); Expenses, Books and
Taxes screens (AR-7); statement page redesign (stays as is, linked from ⋯); bulk actions.

## Progress
Not started.
