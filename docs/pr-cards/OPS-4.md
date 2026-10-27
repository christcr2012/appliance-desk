# OPS-4 — Insurance

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-4. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [x] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [x] Unverified rules run on the careful starting value with their Decisions question filed.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-4` (from main; PR open, see STATUS). Evidence: `tests/ops4-insurance-rules.test.ts`; `tests/ops4-insurance-integration.test.ts` (throwaway Postgres, 5 tests); `e2e/insurance.spec.ts` (CI only). Questions filed: DQ-OPS4-1, DQ-OPS4-2.
**Built 2026-10-27 (PR `ai/claude/ops-vault-gaps`):** "Keep certificate on record" (owner only) makes one Insurance record in the records vault, linked to the policy, so the certificate PDF uploads there with the vault's private storage and file checks; renewing the policy updates that record, and the premium becomes the record's cost. Renewing through the linked record also moves the policy's end date (same step). Not built: premium into the cash budget, and the "staff user marked employee" link (employee count is entered instead).

**Merged (re-checked 2026-10-27):** PR #641, `ci` green at the exact head `7db1a3e4` (check-run read from GitHub). All OPS-1 to OPS-8 test files re-run together on a fresh throwaway Postgres: 20 files, 164 tests, all passing. Acceptance 2 to 4 ticked on that evidence. Acceptance 1 stays open only for the "Not built" items named above.
