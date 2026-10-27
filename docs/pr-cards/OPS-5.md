# OPS-5 — Card disputes and bank returns

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-5. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [ ] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [ ] Unverified rules run on the careful starting value with their Decisions question filed.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-5` (PR open; see STATUS). Evidence (throwaway Postgres or pure tests):
- Rules, packet PDF and photo-dropping to fit Stripe's 5 MB limit: `tests/ops5-dispute-rules.test.ts` (7).
- Dispute events recorded once, out-of-order and final-state safe, matched to the payment; one-time "Approve and send" with a fake Stripe (two presses at once send once; failure releases the claim; late deadline refused; staff refused); bank dispute can't be contested and switches autopay off until cleared; refund on a disputed bill stopped; owner setting range and audit: `tests/ops5-disputes-integration.test.ts` (8).
- Page accessibility: `e2e/disputes.spec.ts` (CI only).
Not built, and why: the 7-day customer notice before a debit date changes. No screen or job lets anyone change a customer's debit date today (only the nightly cycle advance moves it), so there is nothing to attach the notice to; add it with whatever future card adds a "change my billing day" action. The refund-on-dispute warning blocks the refund; the acknowledged override exists in code (`acknowledgeDispute`) but has no button yet.
Filed: DQ-OPS5-1, DQ-OPS5-2; owner row for the three Stripe webhook events. Tick the acceptance boxes only after CI at the exact head.
