> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-02.
> Nothing in this file is a current instruction; any "current", "next" or
> "supersedes" language below is historical. The working documents are
> `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

# Model batches and mandatory switch checkpoints

## Current execution override — 2026-09-30

Chris requests completion of the approved work with the current model and no
more model switching. Larger coherent PRs and continued eligible work supersede
the earlier switch/phase-stop/card-size schedule. Acceptance, CI/preview and
separate activation/spending/destructive-change gates remain. The current
sequence and evidence ledger are in [COMPLETION-PLAN.md](COMPLETION-PLAN.md).
Earlier model and stack instructions below are historical where superseded.


Updated 2026-09-30 at Chris's request. **This is the authoritative execution
order and model assignment for the overhaul.** TASKS.md remains the source
of scope/acceptance criteria; DESIGN.md defines the product. Where older
card headings say L/S or imply numeric execution order, this schedule takes
precedence. AGENTS.md and owner approvals still govern every change.

Goal: as much ready work as possible with one selected model, then an explicit
handoff. Five main batches, four planned model switches. This is not a promise
that every issue can be solved without an exceptional escalation.

## Schedule

| Batch | Select in the model picker | Work in order | End checkpoint |
|---|---|---|---|
| B1 — Foundations and backend contracts | **GPT-6.1 Sol · Medium** | O00, O01, O02, O09, O13 | Confirm safe preview, role rules and tested task/job contracts. Stop and request Luna High. |
| B2 — Main interface overhaul | **GPT-6 Luna · High** | O03, O04, O05, O06, O07, O08, O10, O11, O12, O14, O15, O16, O17-A, O18, O20, O21-A | Complete eligible UI slices and previews; record mandatory Sol review items. Stop and request Sol Medium. |
| B3 — Review and remaining backend work | **GPT-6.1 Sol · Medium** | Review/fix B2 first; then O17-B if needed, O19-A, O21-B, O22, O24, O25-B, O26, O28, O29-A/O29-B if needed | Freeze tested interfaces for the last UI batch. Stop and request Luna High. |
| B4 — Editors, automation UI and documentation draft | **GPT-6 Luna · High** | O19-B, O21-C, O23, O25-A, O27, O29-C if needed, O31-DRAFT | Complete UI integration and draft owner instructions; do not mark O31 complete. Stop and request Sol Medium. |
| B5 — Final integration and release review | **GPT-6.1 Sol · Medium** | Review/fix B4; O30; O31-FINAL | Report evidence and remaining owner inputs; stop for release approval. No automatic deployment or next feature. |

O00 moves from Luna to Sol intentionally to avoid starting with a one-task
model switch. O09/O13 are brought forward because they depend on O01/O02,
not on the redesigned UI. Do not pull optional future schema into B1.

**Current position: B1 authorized and IN_PROGRESS, Sol Medium.**
Chris authorized B1 on 2026-09-30. O00 baseline reconciliation is complete;
see BASELINE.md and EXECUTION-STATE.md. Later batches still require their
model handoff and phase checkpoints.

## Explicit splits of mixed cards

These splits replace ambiguous “L then S” instructions without expanding scope.
Each part has its own PR/evidence if it changes application code.

| Original card | Split and responsibilities | Dependencies |
|---|---|---|
| O17 | A (B2/Luna): restyle existing purchasing UI only. B (B3/Sol): optional reorder-point data and minimal working suggestion UI; Sol completes this small feature end-to-end to avoid an extra switch. | A: O05/O02. B: A and actual need; otherwise DEFERRED. |
| O19 | A (B3/Sol): report definitions, query/DTO changes, fixture reconciliation, and compatibility with existing callers. B (B4/Luna): labels, filters and drill-through using those tested DTOs. | A: O18 reviewed. B: A. |
| O21 | A (B2/Luna): settings navigation/section layout around current intact forms/actions; do not introduce partial saves. B (B3/Sol): section-specific validated actions, conflict/preservation tests, and a documented DTO/action contract. C (B4/Luna): wire individual forms to that contract. | A: O05. B: A. C: B. O21 is complete only after C. |
| O22 | Website revision data can follow O21-B; it does not require O21-C visual integration to exist. Do not expose an unfinished editor. | O02/O21-B. |
| O25 | B (B3/Sol): instrument existing senders one at a time; no UI dependency. A (B4/Luna): automation health UI reading that verified run history. This reverses the original A/B presentation order deliberately. | B: O24; preserve each sender's tests. A: O24/O05 and completed instrumentation contract. |
| O29 | A (B3/Sol): parser/preview validation. B (B3/Sol): bounded idempotent commit service and authorization. C (B4/Luna): preview/confirm/result UI against those services. No real import is run automatically. | O02/O07/O16, and a real import need. C: A/B. Otherwise all three DEFERRED. |
| O31 | DRAFT (B4/Luna): draft guide based on implemented behavior; label unverified portions. FINAL (B5/Sol): reconcile guide with O30 results, fill evidence and release decision. | DRAFT: relevant B4 UI. FINAL: O30 and applicable owner inputs. |

All other numbered cards execute once in the schedule. A whole card is not
complete until all selected parts pass its original acceptance criteria.
Skipping an optional part requires an explicit DEFERRED reason, not “done.”

## Dependency and review rules

1. Batches group **model usage**, not commits or deployment permissions.
   Keep one bounded task/subcard per PR. No large rewrite/mega-PR.
2. Release A–F in DESIGN remain product-review checkpoints. The reordered
   backend prerequisites may be implemented early, but do not constitute
   completion of the later product release. Stop/report at the applicable
   checkpoint before starting its next phase; if the next authorized task
   uses the same model, tell Chris “Keep the current model.”
3. Within the authorized scope, finish ready cards on the current model.
   Do not ask Chris whether to continue after every routine edit. A model
   switch, phase boundary, genuine blocker or required approval is a stop.
4. B2 changes marked for Sol review (O12/O15/O18/O20 and O21 action boundary)
   remain IN_REVIEW until B3 review passes. Luna cannot approve its own
   financial/security review. B4 integration gets equivalent B5 review.
5. Follow PR-STACK.md: every PR starts at the immediately preceding PR's
   current head and targets that PR's branch. Only the root targets main.
   Keep one linear cumulative chain across model switches. Claude reviews
   every PR and the cumulative result before any merge in the selected stack.
   Record exact reviewed SHAs; fixes upstream invalidate impacted reviews.
6. Every application card still passes gate G. Do not postpone basic tests
   until the next Sol batch. Only the independent higher-risk review is batched.
7. Sol can make a necessary small UI fix during its review batch. Do not
   switch back to Luna merely for a typo, failed assertion or local correction.
   A larger UI rework returns to a recorded Luna queue after its contract is fixed.
8. External connections and missing owner details block only their affected
   task/activation. No fabricated values to keep a batch moving. PR #86,
   live email, Stripe, SMS and Workspace authorization retain their own gates.

## Mandatory model switch protocol

At the start of a batch and after a context reset, read EXECUTION-STATE.md
and HANDOFF. Check the actual active model when trusted runtime information
exposes it. Do not infer the active model from an assistant's name, a claim
in a document, or the desired model written in a prompt.

When a different model is required:

1. Finish/save the current safe checkpoint. Record exact branch/commit/PR,
   accepted tests/preview, blockers, owner inputs and next card/subcard.
2. Update EXECUTION-STATE to AWAITING_MODEL_SWITCH and the required model.
3. End the turn with the template below. **Do not execute the next batch's
   code, migration, deployment or review before the switch is acknowledged.**
4. Chris selects the model in the UI and replies “Switched—continue.” If
   the host exposes the model, verify it. If not, use Chris's explicit
   confirmation and record that the model was user-confirmed, not independently
   detected. Do not ask again in the same batch unless evidence conflicts.
5. Resume the recorded next task after checking remote changes. Do not
   restart completed tasks or repeat the entire repository audit.

If Chris only says “continue/resume” while waiting for a switch and no trusted
model information proves it changed, briefly ask him to confirm the requested
selection. General encouragement is not proof of a model change. If he instead
explicitly chooses to keep the current model, revise the schedule accordingly
and record the deviation before work; do not silently pretend a switch occurred.

Switch message, in plain English:

> Batch [B#] is complete: [concrete outcomes]. [Tests/preview and any remaining
> review limitation.] Please select **[exact model] → [Medium for Sol / High for Luna]** before we continue.
> The next batch is [B#], starting with [task and purpose]. Reply
> **“Switched—continue”** once selected. I've saved the handoff; no need to
> paste the plan again.

Do not auto-change the user's model, spawn a different-model subagent, or
imply that saying a model name changes the runtime. If the requested model
is unavailable, ask which supported model the user wants; do not invent access.

## Exceptional escalation

Two failed focused fixes of the same issue, an unresolved authorization/data
integrity question, or a broken backend contract may require Luna -> Sol early.
Record why, stop and request the switch before proceeding. Sol diagnoses/fixes
and reviews the affected contract; then finish other already-authorized,
dependency-ready Sol work when safe. Recompute the remaining queue rather than
blindly hopping back for one small action. Do not use escalation to broaden scope.

A Sol problem is not an automatic license to select Astra. Ask for that
specific model change only with concrete evidence that it would help.
No turnaround time, usage allowance or total project cost is guaranteed.


### Current Codex merge policy (2026-09-30)

The owner now authorizes Codex to merge its own verified PRs as it goes;
the earlier separate Claude-review/owner-merge hold is superseded for those
PRs. See PR-STACK.md's latest authorization entry. CI, exact-head review,
applicable preview evidence, model/phase checkpoints and activation/data/spend
approvals still apply. Claude retains O01 ownership.
