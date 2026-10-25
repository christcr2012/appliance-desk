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
Not started.
