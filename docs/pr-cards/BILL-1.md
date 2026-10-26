# BILL-1 — Bank payments being confirmed: record them, show them, no late fees meanwhile

Build spec: `docs/build-specs/engines/BANK-PAYMENTS-IN-FLIGHT.md` (everything is decided there). Depends on **AR-0b**
(Bills screen) for the screen part; the engine part (steps 1–4) can start any time. Risk: **billing webhooks, late
fees, Stripe provider calls (test mode)**. Read `docs/AI-PR-READ-FIRST.md` first and say in the PR how items 1, 2, 3
and 8 are honored. Never turns anything live.

## Why
A bank (ACH) payment takes up to four business days to clear. Until then the bill looks unpaid: it shows as late, can
get a late fee, and Today asks Chris to chase money that is already on its way. This records "the bank is confirming
a payment" and uses it everywhere, without ever counting it as money received.

## Steps (in order)
1. Additive migration (spec 1) + `src/domains/billing/in-flight.ts` (`inFlightWhere`, `notInFlightWhere`).
2. Webhook writers and clears (spec 2), evidence gathering for `payment_intent.processing`, with the full webhook
   integration test list in spec 2.
3. Nightly check inside `billing-reconcile` (spec 3) with a fake Stripe client test.
4. To do `BANK_PAYMENT_SLOW` + `PAST_DUE_INVOICE` exclusion (spec 4) and the late-fee pause + owner switch (spec 5).
5. Screens (spec 6): Bills tab and pill, customer record line, bill record; Payments tab if AR-3 is merged (otherwise
   AR-3 adds it from this table — say which in the PR).
6. Owner checklist row (spec 7), STATUS, card Progress.

## Acceptance
- [ ] A processing bank payment shows "Being confirmed" on the bill and Bills list and is not counted as paid
      anywhere (totals, books, receipts unchanged — integration test compares before/after).
- [ ] Duplicate and out-of-order webhook deliveries never create two rows or leave a stale open row (tests).
- [ ] No late fee is ever added to a bill while a bank payment is being confirmed (a rule, not a switch); the full late-fee behaviour is FEE-1.
- [ ] Today shows "taking longer than usual" after 6 business days and does not show the bill as late meanwhile.
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist row (once)
Spec section 7 ("Add three payment events to your Stripe webhook").

## Progress
Built on branch `ai/claude/bill-1-bank-in-flight` (PR pending, CI pending). Done: migration, row writers and clears with
duplicate/out-of-order/retry handling, nightly check (50 a night) and "Record it now", Bills tab + pill, bill record and
customer record lines, To do `BANK_PAYMENT_SLOW` + past-due exclusion, late-fee pause under the bill lock, Settings › Bank
payments, Reconciliation section, checklist row, docs. Tests: `tests/bank-in-flight-webhook-integration.test.ts` (20),
`tests/bank-in-flight-nightly.test.ts` (21), `tests/banking-days.test.ts`, updated bill-status test. Not done: Payments tab
(AR-3 adds it from this table). Not observed: any real Stripe test-mode bank payment (checklist row).
