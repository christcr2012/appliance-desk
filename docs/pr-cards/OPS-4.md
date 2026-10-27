# OPS-4 — Insurance

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-4. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [ ] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [ ] Unverified rules run on the careful starting value with their Decisions question filed.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-4` (from main; PR open, see STATUS). Evidence: `tests/ops4-insurance-rules.test.ts`; `tests/ops4-insurance-integration.test.ts` (throwaway Postgres, 5 tests); `e2e/insurance.spec.ts` (CI only). Questions filed: DQ-OPS4-1, DQ-OPS4-2.
Not built: certificate PDF upload (a note says where it is kept; needs VAULT-1 file storage), premium into the cash budget, and the "staff user marked employee" link (employee count is entered instead).
