# O-3B — Approval limits for refunds, credits and kept deposits: prompt for a stronger model (stop rule S-O2)

**Why this exists.** `docs/designs/BATCH-O.md` stop rule S-O2: "a money action cannot be re-run safely from stored input
(it depends on browser state or a provider session)". Checked 2026-10-23 against `src/domains/billing/refunds-base.ts`,
`deposit-refunds.ts` and `money-decisions.ts`:

- `issueInvoiceRefund` / `refundHeldPayment` / `decideDepositRefund` run in two phases: a database transaction that
  prepares the refund (locks, validates, writes a durable `ProviderOperation` intent), then a call to Stripe, then a
  recovery path if the call outcome is unknown. They cannot run inside one approval transaction without either holding a
  database transaction open across a network call, or splitting "request approved" from "refund executed" and handling the
  gap (approved but Stripe failed or UNKNOWN). That is a design decision on money.
- Credits (`applyCreditDecision`) are database-only but are called from several places with different guards.

O-3A (this release) covers write-offs and expense posting, which are database-only, with the approval running the
original function inside the request's own transaction (`writeOffInvoiceInTx`, `postExpenseInTx`).

## Task
Add `REFUND`, `DEPOSIT_KEPT` and `CREDIT` approval kinds (the enum values already exist in the database).

## Requirements
1. Approval must never claim a refund happened until Stripe confirmed. Model it as: PENDING → APPROVED (owner said yes,
   operation intent written, nothing sent yet) → EXECUTED (provider confirmed) or FAILED / UNKNOWN (use the existing
   `ProviderOperation` recovery). Show each state in plain words on `/desk/approvals`.
2. Approval runs as the owner (`assertCapability(tx, ownerId, "ISSUE_REFUND"/"REFUND_DEPOSIT")`), with the requester recorded
   in the audit row and the refund note, exactly as O-3A does for write-offs (`src/domains/approvals/index.ts`).
3. Re-validate against current data when approving (invoice still paid, amount still refundable, deposit still held);
   otherwise mark FAILED with a plain message and change nothing.
4. Same limits screen (`/desk/settings/approvals`): add one box per new kind, blank by default. The owner is never asked.
5. Tests on throwaway Postgres with a fake Stripe client: below limit acts at once; above waits; approve calls Stripe exactly
   once under a double click; Stripe failure leaves a visible FAILED request and no double refund; UNKNOWN is recoverable;
   revoked owner / limited admin; expiry.

## Do not
Hold a database transaction open across a Stripe call. Call Stripe from a test. Widen anyone's access.
