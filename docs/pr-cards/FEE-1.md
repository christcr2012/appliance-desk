# FEE-1 — Fair late fees: tell first, never change a payment in progress

Engine spec: `docs/build-specs/engines/LATE-FEES.md`. Chris, 2026-10-25: a late fee must never be charged before the
customer is told, and must never slip into a payment the customer already started. Depends on BILL-1. **Must merge
before DEC-2 turns on the $5 starting value for new rentals.** Risk: **money and customer messages** (no live email
or texts are turned on).

## Acceptance
- [x] Every legal rule in the spec's "Legal rules" section is enforced with a test (class stored, 10-day rule for every rental, $15 cap, once per bill, payment order, 30-day window, 10-day autopay notice, agreement wording, servicemembers).
- [x] No fee without a delivered warning (or Chris's recorded phone call); otherwise a To do to warn or skip.
- [x] No fee while any payment is in progress or after a payment made by the fee date; a failed payment gets a fresh warning and a new fee date.
- [x] The fee is its own charge on the next bill (or its own bill when the rental ended); the overdue bill's amount never changes.
- [x] Waive before or after billing; once per overdue bill even with two runs at once.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/fee-1-fair-late-fees` (merged PR #614). Items 1-5 checked with database tests on a throwaway Postgres
(tests/late-fee-rules.test.ts, late-fee-engine-integration.test.ts, late-fee-terms.test.ts, late-fee-wording.test.ts).
Not covered: browser test; a real Stripe test-mode fee; attaching to an arbitrary next local bill (separate one-line bill used).
