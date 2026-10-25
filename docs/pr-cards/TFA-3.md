# TFA-3 — Watching official sources and updating itself

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md` sections 12–16. Requested by Chris 2026-10-25. Depends on
TFA-1. Risk: **tax rule changes** — always approved by Chris on To do (his rule, 2026-10-25); strict parsers.

## Acceptance
- [ ] The official-page watches are on (owner switch) and read daily inside each rule's known change window.
- [ ] Strict parsers for the RDF rates, Greeley rate, IRS 1099 threshold and Colorado interest; a changed page layout → "couldn't read", never a guess (fixture tests).
- [ ] Every reading that differs goes to To do for Chris to approve; nothing is applied automatically (test); the old rate auto-apply starts off.
- [ ] Greeley's post-election rate goes through the existing rate review path (Approve on To do).
- [ ] No network in CI; `ci` green at the exact head; every review comment read.

## Progress
Not started.
