# OPS-6 — Collecting from customers who stop paying

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-6. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [x] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [x] Unverified rules run on the careful starting value with their Decisions question filed.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-6` (stacked on OPS-5; PR open, see STATUS). Evidence (throwaway Postgres or pure tests):
- Ladder days, past-due counting, step timing, pickup gate (consent, court order, active duty), small-claims limit, fee and per-county filing counts, notice wording in the business's own name with no agency or threat language, letter and packet PDFs: `tests/ops6-collections-rules.test.ts` (13).
- Product rule — a test fails if agreement, quote, notice or collection wording contains rent-to-own / purchase-option / ownership-transfer language: `tests/ops6-no-ownership-wording.test.ts` (3).
- Nightly pass prepares each step once and sends nothing; approve-to-send once (staff refused, repeat refused, stays waiting when live email is off); pickup refused without agreement and for active duty without a court order; "Customer objected" cancels the visit and brings up small claims; decision recorded once; limit and fee read from the rule book, two recorded filings block a third in the month; paid bills close waiting steps; bad ladder refused: `tests/ops6-collections-integration.test.ts` (9).
- Page accessibility: `e2e/collections.spec.ts` (CI only).
Rule-book rows added with sources (Colorado Judicial Branch, accessed 2026-10-26): limit $7,500; 2 cases a month and 18 a year per county; fee $31 for $1-$500 and $55 for $501-$7,500; claim form JDF 250 "Notice, Claim and Summons".
Not built, and why (also listed in docs/ROADMAP.md, "Parked from Lane 7"): the court form itself is not vendored into the app (the build machine cannot reach the court site and a copied form goes stale); the packet tells Chris to fill in the current JDF 250. Bad-debt tax treatment and write-off stay on the existing approval path (DEC-2). No customer is ever contacted by the nightly pass.
Filed: DQ-OPS6-1, DQ-OPS6-2, DQ-OPS6-3. Tick the acceptance boxes only after CI at the exact head.

**Merged (re-checked 2026-10-27):** PR #636, `ci` green at the exact head `b1b9b5cf` (check-run read from GitHub). All OPS-1 to OPS-8 test files re-run together on a fresh throwaway Postgres: 20 files, 164 tests, all passing. Acceptance 2 to 4 ticked on that evidence. Acceptance 1 stays open only for the "Not built" items named above.
