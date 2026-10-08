# Execution cards — just in time

The selected implementing agent writes a short card for the current capability
and, when useful, its eligible immediate successor. Sol 5.6 at light/medium
is the intended routine use; unresolved semantic conflicts may need deeper
analysis. No required model switch. Avoid writing distant detailed cards whose
prerequisites are still hypothetical. `work-index.json` preserves all later scope.

A missing card required by a design's implementation gate must be written before
coding; the implementer can do this. Approved design/amendments govern semantic
behavior. Cards cannot silently override them. Combine adjacent compatible units
within AGENTS' existing budget; do not create one PR per checkbox.

## Minimum card

Use exact current paths and relevant design headings. Usually 40–100 lines:

- ID, scope/acceptance IDs, prerequisites and actual checked base/head.
- One risk area, migration ownership and realistic budget; split only if needed.
- Bounded reading list and per-card drift disposition.
- Build contract: public types/result unions; transaction/lock boundaries;
  actor and tenant scope; money/provider recovery; setting defaults and immutable
  customer snapshots where relevant. Reuse existing helpers.
- Meaningful named regression cases for acceptance, failure and replay/race paths.
- Targeted commands with `set -o pipefail` when piping output; CI/preview/review
  requirements from AGENTS. Documentation-only work uses documentation checks.
- Explicit gates, completion evidence and changed contracts the successor inherits.

Use `docs/implementation-contracts/DRIFT-PROTOCOL.md` on every implementation
and changed base. Mechanical drift is fixed inline. Semantic uncertainty gets a
reviewed amendment; block only that dependent slice. Update the same card,
work-index/STATUS as needed and CHANGES-SINCE-DESIGN for actual downstream
contract changes; do not create another handoff file.

Validate coverage with `python docs/pr-cards/validate-index.py`.

## Fast authoring with Sol 5.6

Use light effort for an already-proved bounded contract, medium for transactional,
auth/provider/schema or unfamiliar behavior. Author the current card during its
bounded orientation, not as a separate planning session. Cite unchanged schema/
signatures by precise heading/path; spell out changed interfaces, invariants,
permissions and replay/failure tests. After that pass, edit and verify unless a
concrete unresolved decision remains. A Sonnet second opinion is optional and
limited to that question; no mandatory model handoff or parallel planning lane.

If every contract matches the predecessor, record that once in the PR. Update
CHANGES-SINCE-DESIGN only when later work inherits an actual contract change.
