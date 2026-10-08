# PLAYBOOK â€” how to deliver one batch, step by step

Follow these steps in order. Each step says what to do, what "done" looks
like, and what to do if it fails. The rules behind the steps are in
`AGENTS.md`; the work itself is in `docs/PLAN.md`.

## Step 0 â€” Orient once; refresh only what changed

1. Read AGENTS, START-HERE and STATUS. Resume the recorded branch/PR before
   opening a new one. Inspect local changes before switching branches.
2. Read the next roadmap/card and its relevant acceptance, design headings and
   named code/tests in bounded sections. Do not read an entire batch by default.
3. Fetch origin, inspect current main and open PRs; preserve unrelated local work.
   Do not blindly checkout/pull main over an active stack.
4. If no card exists, write it using `docs/pr-cards/README.md` from the approved
   contract and current code. A missing card is work, not a model-switch gate.
5. Check only owner inputs this capability needs; keep gated behavior off.

Done when the scope, acceptance, touched contracts and next action are clear.
There is no required ten-minute reading period.

## Step 0b â€” Drift check before every card and changed base

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Record the actual
base and prerequisite head. Adapt mechanical differences in the current PR.
For a semantic conflict, write a dated contract amendment and apply normal
review before implementing that slice. No compulsory stronger-model session.

## Step 1 â€” Bra¶»§q«^