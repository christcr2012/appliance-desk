# O-3B — Approval limits for refunds, deposit decisions and credits

Design: `docs/designs/BATCH-O.md` D-O3 and `docs/designs/O-3B-STRONGER-MODEL-PROMPT.md`. Builds on O-3A.

## Acceptance
- Settings → Approval limits gains three boxes (blank = no limit, nothing changes until filled): refund a customer
  (invoice refund, held-payment refund, and a deposit refund at or above it), keep part of a deposit (the amount kept),
  apply a customer's credit to an invoice. Same expiry days, same "turn all limits off".
- An OWNER never waits. An ADMIN at or above a limit does not act: a request is stored (one waiting request per target),
  the screen says it was sent. A limited admin (missing refund/deposit capability) cannot even ask.
- Credit: approving applies it inside the request's locked transaction (database only), once.
- Refund / deposit (Stripe): approving is two steps. (A) lock the request, mark it approved, commit: a double click sees
  "already decided". (B) outside any transaction, run the ORIGINAL function as the owner (all normal checks and
  re-validation apply; the requester is named in the refund notes). Finished only when it returns; a refusal marks the
  request FAILED with the plain reason; the screen words Stripe's state from the saved provider record. An approved
  request is never re-run automatically, so a refund cannot be sent twice.
- Every desk path that refunds, decides a deposit, refunds a held payment or applies a credit goes through the approval
  entry points (`submitInvoiceRefund`, `submitHeldPaymentRefund`, `submitDepositDecision`, `submitCreditApply`).
- Tests: `tests/approval-money-integration.test.ts` (real Postgres, fake Stripe).

## Not in this card
- A browser test of the new limit boxes (the page uses the same loop as O-3A's).
- Automatic retry of an approved-but-unfinished refund: deliberately absent. A request is "finished" only when Stripe
  confirmed (or no Stripe step was needed); otherwise it shows "Approved, not finished" with the Stripe state, and Stripe's own
  recovery (Billing → Waiting for Stripe) owns it. If the server stopped between "approved" and "sent", the owner can press
  **Check and finish** after two minutes: it first looks for the refund this approval made (marker in the refund note, or the
  deposit/held payment already changed) and only sends if none exists.
- A deposit refund checks both limits (kept amount, refund amount); the refund limit also applies to a deposit given back.
