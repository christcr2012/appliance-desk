# Designs — how the heavy thinking is handed to the implementer

Each batch in `docs/PLAN.md` has a design document here. The plan says
**what** a batch must achieve and how it is accepted; the design says
**how**: the decisions already made (with the reasoning, so edge cases can be
resolved in the same spirit), the exact schema text, the function signatures,
which existing pattern to copy, the work units in order, the named tests, and
the points where the implementer must stop and ask instead of guessing.

| Batch | Design | Status |
|---|---|---|
| B — Billing, provider reconciliation & financial ledger | `BATCH-B.md` | Built and merged (#141–#161); its leftovers moved to B2 |
| C — Rental-to-service operations, custody, inventory & purchasing | `BATCH-C.md` + `BATCH-C-UPDATE-2026-10-03.md` + `BATCH-C-LITERAL-SPEC-2026-10-03.md` | Built and merged (#169–#175); its only leftover (C-09 pickup billing end) moved to B2 |
| R — Remediation Batch R | `REMEDIATION-BATCH-R-2026-10-04.md` (+ amendment, recovery) | Built and merged (#185–#200) |
| **B2 — Renewal lifecycle, month-to-month rentals, pickup billing end** (finishes B and C) | `BATCH-B2.md` | **Written 2026-10-05 (Claude Opus 5.5, against `main` 47bd833); updated the same night with Chris's answers to IN-29 (early-return options) and IN-30 (missed-reminder screen).** **Approved by Chris 2026-10-05 ("I approve e2 and b2") — implement from it.** Next to build. |
| D — Owner/customer control plane, website, evidence & privacy | `BATCH-D.md` | **Approved** (2026-10-02); **rewritten and drift-checked 2026-10-05** against 47bd833. Starts after B2. |
| E — Communications, automation history, search, brand tokens & accessibility | `BATCH-E.md` | **Approved** (2026-10-02); **rewritten and drift-checked 2026-10-05**. Starts after D. |
| E2 — Visual redesign (owner desk, portal, public site; phone, desktop, dark) | `BATCH-E2.md` | **Written 2026-10-05. Approved by Chris 2026-10-05.** Home page decided (IN-32: ivory in light mode, evergreen in dark mode). Starts after E. |
| F — Integrated verification, recovery, owner handoff & launch ledger | `BATCH-F.md` | **Approved** (2026-10-02); **rewritten and drift-checked 2026-10-05**. Starts after E2. |

**2026-10-05 rewrite (Chris asked for all remaining work to be written so Claude Sonnet 5.5 or ChatGPT Sol 5.6 can build
it).** Every remaining design was re-checked against the code at 47bd833 by reading the functions it names. The drift
check for D, E and F is therefore already done and written into each design's section 0 (with "(changed 2026-10-05)"
marks where the code proved an old assumption wrong). The implementing model still does the short check below at the
start of each batch, but only for files that changed after 47bd833 (`git log 47bd833..main -- <path>`). The 2026-10-02
versions of D, E and F are in `docs/archive/designs-2026-10-02/` for history; they are not instructions.

**Order:** B2 → D → E → E2 → F. One batch at a time, one stack of PRs per batch (`AGENTS.md`).

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

## Design drift check — required at the start of every batch (Chris, 2026-10-03)

Designs for C–F were written before B was built, and each batch changes what the
next one assumes. The implementing model (whichever model Chris has selected) does
this check itself, **before writing any code**:

1. Read `docs/designs/CHANGES-SINCE-DESIGN.md` and the design's "Verify before
   starting" table. Check every row against the code (grep the names, read the
   functions, run the claim), not against memory.
2. Read the design's work units against the code they touch and against
   `docs/BUSINESS-RULES.md`; list every place where the design names a function,
   file, status, table or rule that no longer matches.
3. Write the result as a dated "Drift check" section at the top of the design
   (what matched, what moved, and the exact amendment for each difference), and add
   anything later batches need to `CHANGES-SINCE-DESIGN.md`. Small differences
   (a moved file, a renamed function, a status the design must now include) are
   amended in the design and the batch proceeds.
4. **Stop and hand Chris a prompt for a stronger model** when a difference touches
   a *decision*, not a name: a money rule, a status or state-machine rule, a
   permission boundary, the database design, or anything the design says needs a
   stop-and-ask, and the right amendment is not obvious from the code and docs. The
   prompt must be self-contained (the design, the code locations, the specific
   conflict, and the question). Continue only with work that does not depend on it.
5. Mark the design "Approved" again in the table above only after steps 1–3.

When a batch merges, its last task is to add the dated lines to
`CHANGES-SINCE-DESIGN.md` so the next drift check starts from facts.

## When a design turns out to be wrong mid-implementation

Stop. Record what is wrong in `docs/STATUS.md` under the batch row and in the
PR. Do not improvise a replacement decision in code. A heavy-model session
amends the design (dated "Amendment" section at the bottom, never silent
edits to a decision) and implementation resumes from the amended text.
