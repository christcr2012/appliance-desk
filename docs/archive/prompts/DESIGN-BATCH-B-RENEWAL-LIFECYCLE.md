> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-09.
> Nothing in this file is a current instruction; any "current", "next", "approved" or
> "supersedes" language below is historical. The prompt was answered; the answer is in the
> designs it produced. The working documents are `AGENTS.md`, `docs/SESSION-START.md`,
> `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# Prompt for a stronger model: design amendment for the renewal lifecycle (Batch B, after PR #161)

Copy everything below the line into a new chat with a heavy-reasoning model that can read the repository
`christcr2012/appliance-desk` (branch `main` plus PR #161). Ask for a **design amendment only, not code**. The owner is
not a developer: end with a plain-English summary and the questions only he can answer.

---

Read `AGENTS.md`, `docs/BUSINESS-RULES.md`, `docs/DECISIONS.md` (IN-19 to IN-25), `docs/GO-LIVE-CHECKLIST.md`,
`docs/designs/BATCH-B.md`, and above all `docs/reviews/2026-10-03-pr161-independent-review.md` (an independent review
with findings R1 to R7 and D1 to D2). Read the code it names. Verify each finding yourself against the code before relying on it;
the review's own simulations used fakes and it did not run the real database suite.

Write a dated amendment to `docs/designs/BATCH-B.md` (a new section, same format as the other work units) that settles:

1. **R1/R2 one billing-end intent per subscription.** A durable, ordered way to say "the subscription's end date should be X"
   that is saved in the same database transaction as the decision that causes it (renewal queued, opt-out, early ending,
   renewal cancelled, renewal replaced), executed after commit, re-checked after completion, and recoverable after a crash.
   Superseded operations must be explicit. Fit it to the existing `ProviderOperation` / `runProviderCall` / reconciliation code; do
   not replace the billing system.
2. **R3 the continuing monthly rental.** After a fixed term becomes month to month, what the customer can do online to cancel,
   what record carries their original consent and agreed terms, when billing ends, and how that works with pickup (IN-24 is
   designed separately; say how the two meet). Do not copy fixed-term early-ending fees into the monthly rental.
3. **R4 recurring reminders.** Which reminders Colorado requires over the life of a continuous rental (6-month and 12-month
   starts, anniversaries), how the continuous period is tracked across replacement agreement records, and how each is deduplicated.
   Mark clearly what counsel must confirm.
4. **R5/R6/R7 the notice state machine.** States and transitions, a "missed deadline, owner action needed" outcome, recording the
   provider message id and the original acceptance time, how an uncertain send is recovered inside the email provider's
   24-hour duplicate-protection window, how completion is tied to the attempt that claimed it, and fair retries with limits.
   PR #161 already has simple versions of some of these (see the PR description's "Review findings" lists); say what to keep.
5. **D2 evidence for manual delivery.** Which channels and what evidence count; who may certify (owner only, or admin too).
6. For every item: schema (additive only), function signatures, the named regression tests from the review plus any you add
   (use real Postgres and a paused/reordered fake Stripe), the order of work units, and stop-and-ask points.
7. Which parts of the automatic-renewal feature must stay switched off until each item is built; give the exact lines to add to
   `docs/GO-LIVE-CHECKLIST.md`.

Output: the amendment text ready to paste into `docs/designs/BATCH-B.md`, a list of risks and unknowns, the owner's questions in plain
words, and a short plain-English summary. Do not change code and do not run anything against production.

---

**Added 2026-10-04 — what changed in the code after this prompt was written (read before designing).** Read
`docs/designs/CHANGES-SINCE-DESIGN.md` (sections "IN-28" and "Remediation Batch R") and
`docs/reviews/2026-10-04-remediation-batch-r-acceptance.md`. In short: a deposit now keeps the receipt that paid it across
renewals (`Deposit.sourceReceiptId`); the real first-delivery date is stored once (`RentalAgreement.firstDeliveredOn`) and Stripe
subscriptions are created backdated to that Colorado day with flexible billing (owner decision IN-28: billing begins on delivery);
payment-status reads use one canonical list; the webhook does its Stripe lookups outside the global lock; renewal now cleans up
stale jobs, custody and billing lineage. Your design must fit these, and C-09 (pickup billing) is blocked on the shared contract you
write here.
