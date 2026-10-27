# OPS-8 — Continuity and the yearly check-up

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-8. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [x] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [x] Unverified rules run on the careful starting value with their Decisions question filed.
- [x] `ci` green at the exact head; every review comment read.

## Progress
Built on `ai/claude/ops-8` (PR pending): continuity page, pause switch (owner-only, audited, enforced in `runAutomation`), live snapshot, December yearly check-up To do and walkthrough. Emergency pause for the successor: built (see below). Not computed: vendor-terms and tax set-aside figures are checklist steps that open existing screens, not computed.

**Merged (re-checked 2026-10-27):** PR #653, `ci` green at the exact head `a90b2329`. Codex never posted a finding on #653 (its summary stayed "running" on an older commit); the diff was self-read for permissions (owner-only page and actions, row lock, audit) and enforcement (`runAutomation`) with nothing blocking found. All OPS tests re-run on a fresh throwaway Postgres: 20 files, 164 tests passing. Acceptance 2 to 4 ticked on that evidence.

**Successor pause (branch `ai/claude/successor-pause`, VAULT-1/VAULT-2 now merged):** the emergency contact can press **Pause all automatic charges** from their emergency-access link once the code is confirmed, for the same 24 hours (also after the one download). Pause only: never resume, refund or cancel; the owner is told by email and text; one audit row `continuity.charges_paused_emergency` names the request. Proof: `tests/vault-integration.test.ts` (refused before the code, refused with a bad link, pauses once, no second audit row or notice, still works after the download, owner resumes, refused after the window and when emergency access is switched off). Acceptance 1 stays open only for tax set-aside versus actual and vendor terms, which are walkthrough steps that open existing screens rather than computed figures.
