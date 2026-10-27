# OPS-7 — Privacy and security duties

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-7. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [x] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [x] Unverified rules run on the careful starting value with their Decisions question filed.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-7` (stacked on OPS-6; PR open, see STATUS). Evidence:
- Breach deadlines (30 days from the rule book), Attorney General at 500 and credit bureaus above 1,000 with edge cases, owed-step order, Denver marketing-text window across daylight saving, yearly vendor check, notice letter contents: `tests/ops7-privacy-rules.test.ts`.
- On throwaway Postgres (`tests/ops7-privacy-integration.test.ts`, 6): owner-only incident with a fixed, earlier-only decision date and no closing while a notice is owed; yearly provider check on the To do list; accessibility complaint with fix date; purge ships OFF, is bounded per night, spares converted, recent and legal-hold customers' enquiries; privacy deletion refused under legal hold; marketing text held outside the allowed hours.
- Page accessibility: `e2e/privacy-security.spec.ts` (CI only).
Filed: DQ-OPS7-1, DQ-OPS7-2, DQ-OPS7-3. Not built: ID-image purge (the app stores none), message purge (messages are tied to legal records), the written biometric policy (the setting stays off; the page explains what turning it on requires). Tick the boxes only after CI at the exact head.

**Merged (re-checked 2026-10-27):** PR #637, `ci` green at the exact head `2bf9c5bd` (check-run read from GitHub). All OPS-1 to OPS-8 test files re-run together on a fresh throwaway Postgres: 20 files, 164 tests, all passing. Acceptance 2 to 4 ticked on that evidence. Acceptance 1 stays open only for the "Not built" items named above.
