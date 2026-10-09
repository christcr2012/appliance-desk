# Drift and reconciliation — start of every PR, end of every PR, end of every batch

Code moves while plans sit still. This file is how the implementing model (Sol 5.6 or any other) keeps the plan, the
cards and the code in agreement, **without stopping for a planning session**. Three checklists: **A** before coding each
PR, **B** after each PR merges (before the next slice starts), **C** when a whole batch or major section is finished.
Rewritten 2026-10-09 (Chris: "account for drift and properly handle reconciliation as it completes implementations and
begins the next slice … one for each batch … but also from PR to PR").

**Kinds of drift and what to do** (used by all three checklists):

| Kind | Example | Do this |
|---|---|---|
| Mechanical | file moved, helper renamed, equivalent type, fixture changed | adapt in this PR, correct the card, run the regression. No question to anyone. |
| Already delivered | the card's work exists, with persisted behavior and a passing test | remove it from the card, keep any remainder, cite the PR/test. A symbol alone is not proof. |
| Compatible extension | a new enum value or required field the contract already allows | include it in validators, allowlists, exhaustive branches and tests. |
| Semantic | different money ownership, tax rule, status transition, lock order, signed snapshot, provider replay, data exposure, schema invariant | don't guess. Write the precise question and a proposed safe contract change with its tests as a dated amendment; get it reviewed in the current PR before coding that slice. Continue other approved work. |
| Owner-only | new price or promise, paid resource, legal wording, live activation, destructive production write | keep the gate and its `IN-xx`; build the default-off/manual path if designed; never pretend it is done. |

## A. Start of every PR — drift check (one bounded pass, ~10 minutes)

1. Record: current `main` SHA, the prerequisite PR's final merged SHA, and the card's "Baseline inspected" SHA.
2. Read the predecessor PR's description (dispositions, "carried findings") and the card's resume note if present.
3. See what moved in the card's area:
   `git diff --name-status <card-baseline>..origin/main -- <card's paths> prisma/schema.prisma | head -50`
   For each changed file the card names, read the changed function or test (≤150 lines).
4. Compare only what the card relies on: schema fields/defaults/uniques, exported signatures and result types, who
   calls it and inside which transaction/lock, role checks, money rounding and ownership, activation switches, test
   fixtures, route inventory and shard registry.
5. Write the table in the PR description, then fix the card's affected lines **before** coding:

| Card assumption | Actual at `main` (path + symbol) | Kind | Card correction / test |
|---|---|---|---|

6. Inherited review findings assigned to this card are fixed first, each with its test.

## B. End of every PR — reconcile before the next slice (**inside the same PR, written as if it had already merged**)

Do every step below in the PR itself, before its final push, describing the world *after* the merge ("W-0A merged
(#353)"). Until the PR merges, `main` is untouched, so nothing is wrong early; the moment it merges, the docs are
already correct. (A merge SHA doesn't exist yet: cite the PR number; git history has the SHA.) If the PR is closed
unmerged, its doc edits vanish with it. CI enforces the minimum (`scripts/check-docs-updated.mjs`, in the secret-scan
job): a PR that changes `src/` or `prisma/` must also change `docs/STATUS.md` and its card or `work-index.json`, and
`docs/DATABASE.md` when the schema changes — unless the PR description says "Docs-update: not needed — <reason>".


1. **The card tells the truth.** Its status becomes `MERGED (#n)`; any part that was split off or deferred is
   named with its new owner card.
2. **Successor card updated.** If the next card exists: set its "Baseline inspected" to this merge SHA, fix paths and
   signatures this PR changed, and list any low-risk review findings carried to it (finding, why safe, proving test).
   If it doesn't exist yet (JIT), put the same facts in `docs/designs/CHANGES-SINCE-DESIGN.md` so its author finds them.
3. **Shared contract log only when something downstream changes.** Add a short dated entry to
   `docs/designs/CHANGES-SINCE-DESIGN.md` naming the actual schema/migration, public signatures, guards, locks, settings
   and defaults, activation switches and fixtures later work inherits. "No downstream change" is one line in the PR, not
   a log entry.
4. **Living docs updated for shipped behavior:** `docs/BUSINESS-RULES.md` (a rule changed), `docs/DATABASE.md` (schema),
   `docs/OWNER-GUIDE.md` (something Chris now does differently), `docs/GO-LIVE-CHECKLIST.md` (a new switch or key),
   `docs/OWNER-INPUTS.md` (new question or applied answer).
5. **Queue updated:** `docs/STATUS.md` says this PR merged and "Next" names the next card; `docs/pr-cards/work-index.json`
   status/readiness updated; roadmap row updated. Delete the card's resume note.
6. **If a predecessor changes after its successor branched:** freeze the successor, merge the predecessor, sync the
   successor once onto final `main`, and redo step A only for the contracts that changed.

## C. End of every batch or major section — close-out (one small docs PR)

Do this when the batch's last PR merges, before starting the next batch:

1. **Acceptance is proved.** Every item of the batch's `docs/PLAN.md` acceptance list is checked with evidence (test
   name, PR, CI run, preview). Anything unproved stays open with an owner card — never ticked to close the batch.
2. **Living docs match the code:** BUSINESS-RULES, DATABASE, ARCHITECTURE (new jobs, crons, env vars), OWNER-GUIDE,
   GO-LIVE-CHECKLIST, OWNER-INPUTS.
3. **Retire what no longer instructs anyone** (method below): the batch's design if nothing upcoming depends on it (if
   upcoming work does, mark its status "Built — reference for current behavior" instead), its merged cards, and any
   consumed CHANGES-SINCE-DESIGN entries. Move the batch's acceptance section out of `docs/PLAN.md` into
   `docs/archive/PLAN-completed.md`.
4. **Check the next batch against today's code** before its first card: run its design's "Verify before starting"
   table; classify each difference with the kinds table; amend the design (dated) or record "no drift" in STATUS. Write
   (or refresh) the next batch's first card from the result.
5. **Queue and status:** MASTER-ROADMAP (batch complete, next batch), `work-index.json`, STATUS, and one
   `docs/DECISIONS.md` entry ("Batch X closed: …, retired …, next batch drift: …"). Then tell Chris in plain English.

## Planning while a card is being built

Planning stays authoritative, but it must not keep interrupting implementation (2026-10-09, Sol: roadmap commits
during W-0A caused a rebase conflict and wrong W-0A status lines). A planning or docs PR that lands while a card is in
progress (STATUS "Next"/in-progress line, or an open implementation PR):
- does **not** edit that card's file, its status lines or its work-index entry — the implementing PR owns them;
- adds new material in its own sections and says in its description which in-flight card it affects;
- if the in-flight card must change, says so in one line in STATUS ("W-0A: see Amendment X before merge"); the
  implementer reconciles it once, at the PR boundary (PLAYBOOK Step 5), by merging `main`.

## Retirement method (used by C, or any time a document stops being an instruction)

Based on the first consolidation (#138), which worked best:

1. **Move, don't copy:** `git mv` the file into `docs/archive/<folder>/`. Git history keeps every earlier version, so
   no duplicate snapshot is needed when a working file is rewritten in place.
2. **Banner at the very top:** "> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on <date>. Nothing in
   this file is a current instruction …" naming the working documents to use instead.
3. **Update every reference** — active docs **and** code comments (`git grep -n "<old path>" -- docs src tests e2e
   scripts AGENTS.md`). Comments only; never change runtime code in a retirement PR.
4. **One row in `docs/archive/README.md`:** what it was, and why someone might still open it.
5. **One dated `docs/DECISIONS.md` entry** saying what was retired and why.
6. Validate: `python3 docs/pr-cards/validate-index.py` and `git diff --check`.

## Limits

These checks keep plans and code aligned; they don't prove the code is correct. Exact-head tests, preview and review
remain the completion evidence. A card is trustworthy because it was reconciled at its baseline, not because of who
wrote it.
