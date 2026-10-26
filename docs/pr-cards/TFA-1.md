# TFA-1 — The rule book and the timing rule

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md` sections 1–5. Design: `docs/designs/TAX-FEE-AUTOPILOT.md`.
Requested by Chris 2026-10-25. Depends on DEC-1a. Risk: **tax amounts on bills** (RDF amount, thresholds now read
from dated rules). Read `docs/AI-PR-READ-FIRST.md`.

## Acceptance
- [ ] Every legal number in the research file is a dated rule version with its source; every registry key seeded (test).
- [ ] RDF amount, use-tax threshold, 1099 threshold and record-keeping years are read by date (Jun 30 vs Jul 1 test).
- [ ] The state service fee is 0% from Jan 1, 2026; local lines keep theirs.
- [ ] "File and pay on" dates follow the timing rule (90% of the window, safety margin, never after the due date).
- [ ] Late changes: issued bills unchanged; costs absorbed by the business (books + return); savings credited on the next bill with an explanation (tests).
- [ ] Taxes › Rules shows now/next/source/state, history, owner change with reason, undo of automatic changes.
- [ ] Signed and billed history unchanged; `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/marley/tfa-1` (2026-10-26, PR to open). Migration `20261101000000_legal_rules` with `LegalRuleVersion`, timing settings and `TAX_ABSORBED`; registry + `ruleAsOf`/`nextRuleChange` + timing + true-up + change/undo (`src/domains/rules/`); readers switched (RDF amount/threshold, use-tax threshold, 1099 threshold, record years, state service fee 0% from 2026-01-01, `addRdfRate`, use-tax and retention saves, setup displays); "File and pay on" on return screens and To do; Taxes › Rules screen (`/desk/sales-tax/rules`) with history, change with reason, undo and timing settings. Unit tests pass locally (17 in `tests/rules-registry.test.ts` + `tests/rules-timing.test.ts`); database tests (`tests/rules-as-of-integration.test.ts`) and the browser spec (`e2e/tax-rules.spec.ts`, shard browser-b, the lightest group) run in CI only. Deviations from the spec, noted for review: timing settings live on the Rules screen (the AR-8 settings catalog does not exist on main yet); the Change form allows a past start date as the late-change path (§4's "≥ today" applies to future changes); researched rules have no "Confirm" action yet (DEC-2/TFA-3 confirmation flows do not exist); bonus depreciation `effectiveFrom` is 2025-01-20 (its `acquiredAfter` already encodes Jan 19, 2025).
