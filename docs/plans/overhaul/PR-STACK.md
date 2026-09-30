# Linear PR stack and Claude review gate

Required by Chris on 2026-09-30. Applies across model switches and batches.
**Each PR builds on the previous PR. Claude reviews the entire selected stack
before any PR in that stack is merged. No automatic merging.** This supersedes
any earlier optional guidance about independent task branches.

## How to create the next PR

1. Read the stack ledger below, current remote PR states and latest HANDOFF.
2. Start the new branch from the **current head commit of the immediately
   preceding PR**, not from main or an older local snapshot. Give it a unique
   `ai/<tool>/overhaul-<task-id>` name.
3. Set the new PR's **base to the preceding PR's branch**. Its diff must show
   only the new task, even though its branch contains the cumulative system.
   Only the bottom/root PR targets main.
4. Record predecessor PR, predecessor head SHA, own head SHA, task/model and
   review status in the PR body and execution ledger. Link the predecessor.
5. Run required CI and inspect a preview for that cumulative head. Verify the
   workflow actually ran: a non-main PR base can affect branch-filtered CI.
   Never treat a predecessor's green result as proof for the new head.
6. Continue the linear chain within authorized scope. No sibling feature
   branches, cherry-picking away prerequisites, or isolated replacement PRs.
   Keep each diff bounded even when the full stack becomes substantial.

## Existing stack

| Order | PR | Branch | Base | Purpose |
|---|---|---|---|---|
| 1 | #86 | ai/codex/prelaunch-interest-list | main | Prelaunch signup and welcome-email system |
| 2 | #87 | ai/codex/system-overhaul-plan | ai/codex/prelaunch-interest-list | Design, owner inputs, model batches and this review process |
| 3 | #88 | ai/codex/overhaul-o00 | ai/codex/system-overhaul-plan | O00 baseline/model settings |
| 4 onward | O01A next | ai/<tool>/overhaul-<task-id> | Immediately preceding PR branch | One task/subcard at a time |

Before implementation, verify this table against GitHub; states may change.
PR #87 was originally independent. It is being stacked onto #86 with an
ancestry-preserving merge on its own branch, retaining both sets of handoff
and roadmap entries. This is not a merge to main or a deployment approval.
The next implementation branch starts at #87's latest head unless the owner
has since merged or otherwise changed the stack.

## Review handoff to Claude

At the chosen release/stack checkpoint, provide one manifest in stack order:
`PR | task/subcard | model | base PR/SHA | head SHA | CI | preview | open risks`.
Ask Claude to review BOTH the small per-PR diffs and the cumulative diff from
main through the stack tip, including interactions and business invariants.
Claude must record APPROVED or CHANGES_REQUESTED against exact head SHAs.
The implementing model's self-review or Sol review is not a substitute for
Chris's requested Claude review. Do not claim approval without evidence.

Claude must review every PR in the selected stack before the first is merged.
Chris may choose a release-sized stack instead of holding the entire overhaul
open; that choice defines the review checkpoint, not permission to merge early.
Absent a narrower explicit choice, hold the entire current open chain.
The merge decision remains with Chris or an explicitly authorized reviewer.

## Fixing an earlier PR

- Commit the fix to its owning branch. Preserve unrelated changes.
- Incorporate the updated parent into each descendant in order. Prefer normal
  merge commits over rewriting shared history; never blindly force-push.
- Resolve conflicts deliberately, retaining both agents' HANDOFF/ROADMAP notes.
- Refresh exact SHAs, rerun affected CI/preview, and mark impacted reviews stale.
- Ask Claude to re-review changed PRs and affected integration surfaces. Do not
  carry an approval forward merely because a PR number stayed the same.

## After approval and explicit merge authorization

Merge oldest to newest. After each merge, confirm how GitHub retargeted the
next PR; set its base to main when its entire predecessor chain is on main.
Check that the remaining diff contains only intended work, dependencies still
exist, and required checks apply to the current head/base. Do not delete a
parent branch while descendants still rely on it. Any code/conflict change
invalidates affected evidence and needs renewed review before proceeding.
No wholesale main replacement, migration rollback, squash/cherry-pick shortcut
that loses a prerequisite, or auto-enable of email/Stripe/SMS is permitted.

Stacked PRs do not relax preview isolation: cumulative preview builds can run
all pending migrations. Keep production data and outbound messages protected.
