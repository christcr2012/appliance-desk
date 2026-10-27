# OPS-1 — Product recalls

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-1. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [x] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [x] Unverified rules run on the careful starting value with their Decisions question filed.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-1` (PR open; see STATUS). Evidence so far, all on a throwaway Postgres or pure tests:
- Matcher and reader of the government list: `tests/ops1-recall-matcher.test.ts` (14), fixture is synthetic (the build machine could not reach saferproducts.gov).
- Nightly check possible-only and repeat-safe, hold enforced on rent/reserve/swap/status/cleaning/sale/parts, renter To do (one per renter, nothing sent), safety-incident flow, owner/admin only: `tests/ops1-recalls-integration.test.ts` (11).
- Safe JSON fetch and cron route: `tests/ops1-safe-json-fetch.test.ts`, `tests/ops1-recall-cron-route.test.ts`.
- Browser/accessibility page check: `e2e/recalls.spec.ts` (runs in CI only).
Decision filed: DQ-OPS1-1 (does renting count as distribution). Owner row filed: confirm the live government answer matches the parsed shape.
Added beyond spec: REMEDIED state. Tick the acceptance boxes only after CI at the exact head.

**Merged (re-checked 2026-10-27):** PR #623, `ci` green at the exact head `f7db1c05` (check-run read from GitHub). All OPS-1 to OPS-8 test files re-run together on a fresh throwaway Postgres: 20 files, 164 tests, all passing. Acceptance 2 to 4 ticked on that evidence. Acceptance 1 stays open only for the "Not built" items named above.
