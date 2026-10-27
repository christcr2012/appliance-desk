# OPS-2 — Refrigerant and disposal records

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-2. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [x] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [x] Unverified rules run on the careful starting value with their Decisions question filed.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/claude/ops-2` (from main; PR open, see STATUS). Evidence:
- Pure rules, input checks, keep-until date and the statement's required contents / PDF: `tests/ops2-refrigerant-rules.test.ts`.
- On throwaway Postgres (`tests/ops2-refrigerant-integration.test.ts`, 6): scrap, throw away, strip-then-discard and bulk "mark done" are refused for a refrigerant appliance until the signed record exists (message names the appliance in bulk); washers and fridges being sold are not asked; staff, missing signature and future dates refused; record locks once done; statement rebuilt from the saved row; owner-only setting of which types have refrigerant.
Filed: DQ-OPS2-1. **Built 2026-10-27:** "Keep the recycler's receipt photo with my business records" (owner only, after signing) makes one record in the vault for the receipt photo or PDF. Not built: the sealed-system repair gate (needs a technician certification record from VAULT-1, which does not exist yet). Tick the boxes only after CI at the exact head.

**Merged (re-checked 2026-10-27):** PR #640, `ci` green at the exact head `5d88b75e` (check-run read from GitHub). All OPS-1 to OPS-8 test files re-run together on a fresh throwaway Postgres: 20 files, 164 tests, all passing. Acceptance 2 to 4 ticked on that evidence. Acceptance 1 stays open only for the "Not built" items named above.
