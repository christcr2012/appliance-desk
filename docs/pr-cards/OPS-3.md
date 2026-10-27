# OPS-3 — Vehicle, mileage and driving rules

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-3. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [ ] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [ ] Unverified rules run on the careful starting value with their Decisions question filed.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-3` (from main; PR open, see STATUS). Evidence: `tests/ops3-vehicle-rules.test.ts`; `tests/ops3-vehicle-integration.test.ts` (throwaway Postgres, 7 tests); `e2e/vehicle.spec.ts` (CI only). Questions filed: DQ-OPS3-1, DQ-OPS3-2.
Not built: actual-cost comparison from the books, vehicle-to-insurance-policy link, CMP-2 feed, and the first/last-stop prompt (a card on the Driver view instead).
