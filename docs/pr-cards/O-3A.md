# O-3A — Approval limits for write-offs and expense posting

Design: `docs/designs/BATCH-O.md` D-O3 and the "Approval/price command transaction clarification".

## Acceptance
- Settings → Approval limits (owner only): one dollar limit per kind (write-off, expense), blank = no limit, expiry days
  (1–30, starts 7). Everything starts blank, so nothing changes until the owner sets one. "Fill in $50 / $250" buttons only
  fill the box. "Turn all limits off" restores the starting point. Saved in `BusinessSettings` with an audit row.
- An OWNER never waits. An ADMIN starting a write-off or posting an expense at or above the limit does not act: a
  request is stored (one waiting request per invoice/expense) and the screen says "Sent to the owner for approval. Nothing
  has changed yet." A limited admin (O-2A) cannot even ask. "Post now" when creating an expense follows the same rule.
- `/desk/approvals` (owner only): waiting requests with who, when, amount, plain summary, optional note, Approve and do it
  now / Decline; recent decisions. Today shows ONE owner-only item "Requests waiting for your approval (n)".
- Approve runs the original function again in the request's own transaction, as the owner (`writeOffInvoiceInTx`,
  `postExpenseInTx`), after locking the request, once. The write-off reason names the requester. If the thing changed
  meanwhile (invoice paid, expense already posted) the request becomes FAILED with a plain message and nothing changes.
  Expired requests cannot be approved.
- Tests: `tests/approvals.test.ts` (pure rule), `tests/approvals-integration.test.ts` (real Postgres: below limit acts at
  once, owner bypass, waits and does not stack, approve once as owner, concurrent approvals once, stale input fails safely,
  decline, expiry, only the owner decides, limited admin cannot ask, expense waits and decline leaves it unposted, limits
  validated and audited).

## Not in this card
- **Refunds, credits, kept deposits**: they call Stripe in two phases, so re-running them from stored input is stop rule
  S-O2. Prompt written: `docs/designs/O-3B-STRONGER-MODEL-PROMPT.md`. The limits screen says they are not covered yet.
- Approving an expense is covered by the existing expense tests through the same inner function; the approval tests prove
  the expense request is stored and declined without posting but do not post a real expense (it needs full use-tax setup).
- Entry points: the approval check lives in the desk actions (`submitWriteOff`, `submitExpensePost`). The domain functions
  `writeOffInvoice` / `postExpense` stay directly callable by other code paths; today the only callers are those actions.
