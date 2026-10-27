# OPS-8 — Continuity and the yearly check-up

Build spec: `docs/build-specs/engines/OWNER-OPERATIONS.md` section OPS-8. Facts: `docs/research/2026-10-25-operating-risks.md`.
Decided and designed for Chris 2026-10-25 ("decide and design anything else that should be built in"). Depends on
TFA-1 (dated rules) and VAULT-1 where the spec says. Risk: see the spec section.

## Acceptance
- [ ] Everything listed in the spec section is built, with the tests named there.
- [ ] Anything that changes money, customers or filings waits for Chris's Approve on To do.
- [ ] Unverified rules run on the careful starting value with their Decisions question filed.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on `ai/claude/ops-8` (PR pending): continuity page, pause switch (owner-only, audited, enforced in `runAutomation`), live snapshot, December yearly check-up To do and walkthrough. Not built: emergency access for the successor (needs VAULT-1; recorded on the owner checklist), vendor-terms and tax set-aside figures are checklist steps that open existing screens, not computed.
