# W-0C — Failed automatic card charges appear in To do

Status: **COMPLETE — merged by the W-0C PR after exact-head CI** (PR number in GitHub history).
Batch: W Amendment B (APPROVED, IN-69) §6.1. Base: `main` c712834 after #358.
Migration: none. Money-sensitive. No live Stripe activation, changes to late fees, provider calls, or customer messages.

## Source and drift check A

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md` checklists A and B; the evidence below satisfies A. B is recorded in STATUS, BUSINESS-RULES, work-index, and CHANGES-SINCE-DESIGN.
- `docs/designs/BATCH-W-AMENDMENT-B.md` §6.1: APPROVED failed-payment/To do contract.
- `src/domains/billing/webhooks-base.ts`: existing invoice still returned on failed event; not fixed by #356, #357 or #358.
- `src/domains/exceptions/index.ts` and `rules.ts`: required overdue due date; invoice route already exists under
  `src/app/desk/billing/customer/[id]/invoice/[invoiceId]/page.tsx`.
- No semantic drift. IN-71 retained records for seven years by default (configurable, CPA question) is outside this card.

## Acceptance
1. `invoice.payment_failed` on existing OPEN / PARTIALLY_PAID invoice changes to DELINQUENT and writes
   exactly one failure attempt for a replayed event. PAID and VOID can never be reopened by a late failure.
   Fresh failed invoice creates DELINQUENT with or without a due date.
2. To do shows DELINQUENT regardless of due date; PARTIALLY_PAID regardless of due date; OPEN only
   when past due. It shows dollars still owed; a missing due date uses the failed payment attempt date
   for ordering, never suppresses the item.
3. Every item links to `/desk/billing/customer/{customerId}/invoice/{invoiceId}`.
4. Leave late-fee due-date requirement as-is, and document that a first failed attempt must **not**
   start late fees without a later explicit owner approval.
5. No schema change, no spending, no notifications, no live payments.

## Evidence
- Verified 2026-10-09: 45 targeted tests passed (5 files) against disposable sandbox PostgreSQL; no skipped tests.
- Disposable local Postgres: `tests/billing-webhook-ordering-integration.test.ts`,
  `tests/remediation-r2-bounded-exceptions-integration.test.ts`, and
  `tests/billing-webhooks.test.ts` (new-invoice path).
- Unit: `tests/exceptions.test.ts`; route: `tests/today-href-routes.test.ts`.
- Run `npm run preflight -- --unit tests/exceptions.test.ts --unit tests/today-href-routes.test.ts --db tests/billing-webhook-ordering-integration.test.ts --db tests/remediation-r2-bounded-exceptions-integration.test.ts`,
  then push once, exact-head CI, review, and merge.
