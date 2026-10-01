# Webhook atomicity — security audit P0 follow-on

The old entry point checked WebhookEvent, committed handler writes in independent
transactions, then inserted the event receipt. A final receipt failure left payment
state committed without dedupe; simultaneous deliveries could both enter. Different
completed/async-success events could duplicate one signing payment, and cumulative
refund deltas could both read the same old total.

The repair uses one explicit Prisma transaction client for every local read/write,
a dedicated Postgres transaction-scoped advisory lock (two-int namespace 174831/1),
and the final event receipt in that same transaction. Single-business serialization
covers distinct event IDs too. The lock releases on commit/rollback; no session lock
or in-memory mutex. Settled signing payments dedupe by successful PaymentIntent with
agreement/customer checks; legacy Stripe invoices reuse/skip the existing record.
Existing ACH pending/failure behavior remains unpaid; failed-to-paid invoice recovery
remains supported. No production schema change, new payment, provider mutation or
historical repair is performed by this PR.

## Verification

`tests/webhook-atomicity-integration.test.ts` exercises real writes in CI-only
localhost/127.0.0.1 `/appliance_desk_test`: simultaneous duplicate events, distinct
settled events for one signing payment, ACH pending/success/failure, failed final
receipt with complete rollback/retry, overlapping cumulative refunds and legacy
checkout/invoice-paid overlap. Fixture IDs belong only to the suite. Its failure
trigger/function are generated safe hex identifiers, affect only its own event ID,
and are removed in finally/cleanup. Existing invoice recovery and estimate-deposit
suites remain part of full CI. No hosted fixture or production cleanup is allowed.

Local: 812 tests pass; 23 guarded CI-only cases skipped; four existing DB suites
excluded. Type-check and lint pass (two existing warnings). Full CI/preview/exact-head
verification still pending; these local checks do not prove database atomicity.

## Remaining limits

- All webhooks for this single business serialize, favoring correctness over
  throughput. Transaction acquisition waits at most 10 seconds; lifetime is
  30 seconds. Provider reads occur inside the transaction; their request timeouts
  are separate, may delay the response, and must not be called charges or cancelled
  merely because the local transaction expires. No success response before commit.
  Hosted provider-latency/capacity acceptance remains part of release evidence.
- Other writers do not automatically share this webhook lock. This PR does not
  establish a general refund approval/reconciliation or manual-payment locking
  contract. Existing historical duplicate/drift records need explicit safe review.
- Description-based line classification/matching (audit P1), future payment metadata
  handling, full reconciliation, customer-visible ACH monitoring and all other
  audit items remain tracked; no claim that the security audit is complete.
- Preview isolation/storage O02, O13/O14 and O32 gates remain. No live activation,
  spending or destructive real-data action. Revert the PR for rollback; receipt and
  accounting records are not deleted or rewritten by that rollback.
