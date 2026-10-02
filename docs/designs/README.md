# Designs — how the heavy thinking is handed to the implementer

Each batch in `docs/PLAN.md` has a design document here. The plan says
**what** a batch must achieve and how it is accepted; the design says
**how**: the decisions already made (with the reasoning, so edge cases can be
resolved in the same spirit), the exact schema text, the function signatures,
which existing pattern to copy, the work units in order, the named tests, and
the points where the implementer must stop and ask instead of guessing.

| Batch | Design | Status |
|---|---|---|
| B — Billing, provider reconciliation & financial ledger | `BATCH-B.md` | Approved 2026-10-02 |
| C — Rental-to-service operations, custody, inventory & purchasing | `BATCH-C.md` | Approved 2026-10-02 (verify §0 after B merges) |
| D — Owner/customer control plane, website, evidence & privacy | `BATCH-D.md` | Approved 2026-10-02 (verify §0 after C merges) |
| E — Communications, reporting, growth, branding & accessibility | `BATCH-E.md` | Approved 2026-10-02 (verify §0 after D merges) |
| F — Integrated verification, recovery, owner handoff & launch ledger | `BATCH-F.md` | Approved 2026-10-02 (verify §0 after E merges) |

## The rule

**Implementation models build only from an approved design.** They do not
re-decide anything in a design's "Decisions" section, do not add tables,
columns, libraries or patterns the design does not name, and when the design
is silent on something that matters, they stop and ask (the design's
"Stop-and-ask" list says how) rather than invent. A design written against
older code has a "Verify before starting" table; every row must be checked
before work starts, and a false row is a stop.

## Who writes designs

A heavy-reasoning model (the one Chris selects for design passes), from
`TEMPLATE.md`, after reading the code the batch touches — never from the
plan alone. Designs for C–F were written before B merged; when a batch's
turn comes, the design pass is a *re-verification*: read §0, re-read the code
it names, amend the design (dated note at the top) if the code moved, then
mark it approved for implementation in the table above.

## When a design turns out to be wrong mid-implementation

Stop. Record what is wrong in `docs/STATUS.md` under the batch row and in the
PR. Do not improvise a replacement decision in code. A heavy-model session
amends the design (dated "Amendment" section at the bottom, never silent
edits to a decision) and implementation resumes from the amended text.
