# Execution cards — just in time

**Owner-answer crosswalk:** [October 13 implementation map](../owner-decisions/2026-10-13-implementation-map.json)
and [engineering contract](../designs/OWNER-DECISIONS-2026-10-13-ENGINEERING.md)
contain 56 source-backed subject decisions and acceptance expectations.
When authoring the **current ordered approved unit** only, include matching
subject IDs in its short card/drift handoff. This adds no new ticket sequence
or external use approval. scripts/check-owner-decisions.mjs validates the map.


The selected implementing agent writes a short card for the current capability
and, when useful, its eligible immediate successor. Sol 5.6 at light/medium
is the intended routine use; unresolved semantic conflicts may need deeper
analysis. No required model switch. Avoid writing distant detailed cards whose
prerequisites are still hypothetical. `work-index.json` preserves all later scope.

A missing card required by a design's implementation gate must be written before
coding; the implementer can do this. Approved design/amendments govern semantic
behavior. Cards cannot silently override them. Combine adjacent compatible units
under AGENTS' outcome-led risk/review guidance; do not create one PR per checkbox.

## Concrete execution packet

Use [IMPLEMENTATION-RECIPES](../implementation-contracts/IMPLEMENTATION-RECIPES.md#card-packet)
to add exact file/symbol/caller, input→storage→DTO mappings, ordered locks/side effects,
fixture numbers, before/after counts and successor exports to the current card. Read
only its matching recipe. [W-22 persistence](../implementation-contracts/W-22-PERSISTENCE-RECIPE.md)
is the next-unit worked example at #396; it proposes interfaces, not an approved
schema or a prewritten distant card. Resolve them JIT under the drift protocol.

## Minimum card

Use exact current paths and relevant design headings. Usually 40–100 lines:

- ID, scope/acceptance IDs, prerequisites and actual checked base/head.
- One coherent integration/risk boundary, migration ordering/ownership and realistic estimate; split only for a concrete reason.
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

## Checked packet: one current capability, no repeated archaeology

The active short card explains changed input→storage→DTO mappings, lock/side-effect
boundaries, exact fixture numbers and before/after counts. Its adjacent JSON packet
routes the implementer to **existing** symbols and supplies validated test selectors.
Historical slice logs go in `docs/archive/implementation-history/`; do not append
another long historical chapter to the active card. Parent acceptance stays open
until the full workflow is proved. No automatic readiness inference from APPROVED.

Register the packet in `work-index.json`'s `executionPackets` and select it with
`activeExecution`. Reuse [W-22D12](W-22D12.md) and [its packet](execution/W-22D12.json)
as a worked example, changing actual contracts rather than copying its financial fixtures.
The schema is implemented in `scripts/work-packet.mjs` and enforced by `check:work`/CI:

| Field | Meaning |
|---|---|
| `version`, `id`, `parent`, `baseline`, `card` | Version 1; stable capability/parent IDs; inspected full Git SHA; existing current card |
| `outcome`, `risk`, `next` | Complete observable result; coherent risk boundary; exact unfinished successor |
| `references` | Existing repository `path`, exact `anchor` symbol/heading, and bounded reading `purpose`; 1–12 |
| `proposedFiles` | Explicitly new paths, including tests; not evidence they exist or work |
| `invariants`, `sequence`, `acceptance` | Immutable contracts, ordered integration, meaningful expected results |
| `gates` | Stable id, exact affected operation, existing source, attempted/needed remedy and reopening trigger |
| `checks` | `unit`/`db`/`browser`/`node` arrays of exact regression paths; no arbitrary command or shell strings |

`work -- read <number>` prints bounded context around a checked anchor (not a whole file).
`work -- check` rejects missing existing files/anchors, wrong parent, unsafe/symlink
paths and invalid selectors. `plan` displays missing proposed tests; `verify` refuses
them until implemented. The command runs existing preflight/DB/browser launchers,
not a weaker validation path. `probe` is diagnosis only. `route <unit>` prints the
later scope's existing discovery anchors; it never marks dependencies accepted.
When a capability finishes, update the next current packet in that same substantive
PR; preserve parent/acceptance IDs and refresh against actual main/review evidence.

A packet is navigation, not business approval, feature completion or real-provider
acceptance. Scripts check existence/anchors, not semantics. Keep actual owner inputs
and independent external proof visible. Never put secrets/customer facts/provider
IDs into the public packet. Do not write all future packets before their predecessors
are real; this would recreate stale distant planning.
