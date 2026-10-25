# TFA-3 — Watching official sources and updating itself

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md` sections 12–16. Requested by Chris 2026-10-25. Depends on
TFA-1. Risk: **automatic changes to tax rules** (strict parsers, two agreeing reads, future-only, plausibility
bounds, Undo).

## Acceptance
- [ ] The official-page watches are on (owner switch) and read daily inside each rule's known change window.
- [ ] Strict parsers for the RDF rates, Greeley rate, IRS 1099 threshold and Colorado interest; a changed page layout → "couldn't read", never a guess (fixture tests).
- [ ] Changes apply automatically only when the guards hold, with an Undo To do; otherwise a review To do with Apply.
- [ ] Greeley's post-election rate flows through the existing rate auto-apply/undo path.
- [ ] No network in CI; `ci` green at the exact head; every review comment read.

## Progress
Not started.
