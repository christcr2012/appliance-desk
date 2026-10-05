# Designs — how the heavy thinking is handed to the implementer

Each batch in `docs/PLAN.md` has a design document here. The plan says
**what** a batch must achieve and how it is accepted; the design says
**how**: the decisions already made (with the reasoning, so edge cases can be
resolved in the same spirit), the exact schema text, the function signatures,
which existing pattern to copy, the work units in order, the named tests, and
the points where the implementer must stop and ask instead of guessing.

| Batch | Design | Status |
|---|---|---|
| B — Billing, provider reconciliation & financial ledger | `BATCH-B.md` | Built and merged; its renewal/pickup leftovers were completed by B2. |
| C — Rental-to-service operations, custody, inventory & purchasing | `BATCH-C.md` + `BATCH-C-UPDATE-2026-10-03.md` + `BATCH-C-LITERAL-SPEC-2026-10-03.md` | Built and merged; its shared billing-end leftover was completed by B2. |
| R — Remediation Batch R | `REMEDIATION-BATCH-R-2026-10-04.md` (+ amendment, recovery) | Built and merged. |
| B2 — Renewal lifecycle, month-to-month rentals, pickup billing end | `BATCH-B2.md` | Built before Batch D; D's implementation uses these contracts. |
| D — Owner/customer control plane, website, evidence & privacy | `BATCH-D.md` | **Implemented through the final D branch.** D1–D9 predecessors are merged; D10–D12 finalization is on `ai/sol/batch-d-d10-privacy`. Post-D reconciliation explicitly moved the one uncovered audit outcome, B08 lead-scoring configurability, into E's lead/settings migration instead of adding a one-off late D schema change. |
| E — Communications, automation history, search, brand tokens & accessibility | `BATCH-E.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | **Approved design, but implementation BLOCKED until final D is green and merged.** Reconciliation adds D's privacy sender/routes/metrics and the explicit B08 lead-scoring policy work. |
| E2 — Visual redesign (owner desk, portal, public site; phone, desktop, dark) | `BATCH-E2.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | Approved. Starts after E; must preserve D's website-editor preview, settings-backed copy/chrome and legal-page gate. |
| F — Integrated verification, recovery, owner handoff & launch ledger | `BATCH-F.md` + **`POST-BATCH-D-RECONCILIATION-2026-10-05.md`** | Approved. Starts after E2; recovery must respect D privacy deletion and must never resurrect intentionally deleted private media. |

**2026-10-05 post-D reconciliation.** D, E and F had been designed/reworked against code that predated the actual
Batch D implementation. Before any E code is written, read
`POST-BATCH-D-RECONCILIATION-2026-10-05.md`. It records the implemented D contracts and the exact E/E2/F amendments:
D's new privacy-verification sender joins E's message ledger migration; E updates D's existing `METRICS` registry
instead of creating competing definitions; B08 lead scoring becomes a versioned BusinessSettings policy in E's
already-planned Lead/BusinessSettings migration; E's distributed limiter preserves D's public-privacy semantics;
E2 keeps D's draft website preview and versioned legal gate; and F's second private-media copy may never survive a
verified privacy deletion or be restored later. Where the older E/E2/F text conflicts with that reconciliation, the
reconciliation wins.

The older 2026-10-02 designs remain under `docs/archive/designs-2026-10-02/` for history; they are not instructions.

**Order:** B2 → D → E → E2 → F. One batch at a time, one stack of PRs per batch (`AGENTS.md`).

## The rule

**Implementation models build only from an approved design.** They do not
re-decide anything in a design's "Decisions" section, do not add tables,
columns, libraries or patterns the design does not name, and when the design
is silent on something that matters, they stop and ask (the design's
"Stop-and-ask" list says how) rather than invent. A design written against
older code has a "Verify before starting" table; every row must be checked
before work starts, and a false row is a stop.

For E, E2 and F, the approved instruction set is the batch design **plus**
`POST-BATCH-D-RECONCILIATION-2026-10-05.md`.

## Who writes designs

A heavy-reasoning model (the one Chris selects for design passes), from
`TEMPLATE.md`, after reading the code the batch touches — never from the
plan alone. Designs for later batches are re-verified after each preceding
batch because merged code is more authoritative than assumptions made while
that code was still only planned.

## Design drift check — required at the start of every batch (Chris, 2026-10-03)

Each batch changes what the next one assumes. The implementing model
(whichever model Chris has selected) does this check itself, **before writing
any code**:

1. Read `docs/designs/CHANGES-SINCE-DESIGN.md`, any later mandatory reconciliation
   named in this README, and the design's "Verify before starting" table. Check
   every row against the code (grep the names, read the functions, run the
   claim), not against memory.
2. Read the design's work units against the code they touch and against
   `docs/BUSINESS-RULES.md`; list every place where the design names a function,
   file, status, table or rule that no longer matches.
3. Write the result as a dated "Drift check" section in the implementation PR
   (and amend the design/reconciliation when needed), and add anything later
   batches need to `CHANGES-SINCE-DESIGN.md`. Small differences (a moved file,
   a renamed function, a status the design must now include) are amended and the
   batch proceeds.
4. **Stop and hand Chris a prompt for a stronger model** when a difference touches
   a *decision*, not a name: a money rule, a status or state-machine rule, a
   permission boundary, the database design, or anything the design says needs a
   stop-and-ask, and the right amendment is not obvious from the code and docs. The
   prompt must be self-contained (the design, the code locations, the specific
   conflict, and the question). Continue only with work that does not depend on it.
5. Mark the design "Approved" again in this table only after the check is complete.

When a batch merges, its last task is to add the dated lines to
`CHANGES-SINCE-DESIGN.md` so the next drift check starts from facts.

## When a design turns out to be wrong mid-implementation

Stop. Record what is wrong in `docs/STATUS.md` under the batch row and in the
PR. Do not improvise a replacement decision in code. A heavy-model session
amends the design (dated "Amendment" section, never a silent change to a
business decision) and implementation resumes from the amended text.
