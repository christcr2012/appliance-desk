## Current owner batching instruction — 2026-10-01

Chris requires far fewer, much larger PRs because each PR repeats full CI.
Use [REMAINING-BATCHES.md](REMAINING-BATCHES.md): five substantial remaining
batches, with at most one conditional Google follow-up if external gates lag.
This supersedes small card/file/page-family/report/cron/integration PR splits
and old model/phase-stop schedules. Keep one agent/current model, acceptance
criteria, O02 and other dependencies, full batch CI/preview and separate live,
spending/destructive approvals. Audit implementation follows the original
roadmap. No planning-only PR: include this checkpoint with batch 1 code.

# Low-cost implementation guide and paste-ready prompt

## Current execution override — 2026-09-30

Chris requests completion of the approved work with the current model and no
more model switching. Larger coherent PRs and continued eligible work supersede
the earlier switch/phase-stop/card-size schedule. Acceptance, CI/preview and
separate activation/spending/destructive-change gates remain. The current
sequence and evidence ledger are in [COMPLETION-PLAN.md](COMPLETION-PLAN.md).
Earlier model and stack instructions below are historical where superseded.


## Model recommendation — verified 2026-09-30

Follow **MODEL-BATCHES.md**: Sol Medium -> Luna High -> Sol Medium -> Luna High
-> Sol Medium. EXECUTION-STATE.md identifies the next batch/task. These are
explicit user-selected model checkpoints; the assistant must stop and direct
Chris to switch before continuing under another model. Four planned switches,
with additional switches only for a documented blocker or user preference.
If Chris explicitly chooses one model throughout, use GPT-6.1 Sol and record
that schedule override. Do not silently substitute the one-model alternative.
These assignments are engineering judgment, not a repository benchmark.

Official sources checked:
- https://learn.chatgpt.com/docs/models — Sol for complex coding/agentic work,
  Luna for focused repeatable work; recommends High for Luna; availability
  depends on account/client. GPT-5.4 Mini retired from Codex ChatGPT sign-in
  on August 31, 2026, so it is not the recommended Codex choice here.
- https://developers.openai.com/api/docs/models — current standard API list
  shows Luna $0.10 input/$0.50 output and Sol6.1 $2 input/$10 output per 1M
  tokens. This is API token pricing, NOT a quote for ChatGPT Plus usage,
  Work credits, tool calls, reasoning totals, hosting, or the completed project.

Do not buy another subscription before checking the user's existing model
picker. Start with O03/O04 as the first representative Luna UI tasks after
O00 and the necessary foundations. Compare accepted PR cost/rework, not raw
output speed. No fixed dollar or completion-time promise is justified yet.

## Keep it cheap without reducing the required quality

1. Work through eligible cards within the authorized current model batch, one card/subcard at a time. Load AGENTS, HANDOFF tail, the relevant DESIGN
   section, that card and named files/tests. Search before loading giant docs.
2. Reuse existing domain actions/components. Do not spend tokens rebuilding
   a CRM that already exists or rewriting intact files for cosmetic changes.
3. Request a <=8-line understanding/acceptance summary, then implementation.
   No repeated essays or exhaustive unrelated repository rescans.
4. Split a data contract from its UI. Sol produces reviewed schema/actions;
   Luna implements the narrow presentation against that contract.
5. Run targeted tests while iterating, then the required full CI once the
   slice is ready. Rerun failed checks for a concrete reason; don't add tests
   that only repeat trivial markup. Never skip required CI to save tokens.
6. After two unsuccessful fixes of the SAME failure, stop speculative edits
   and save the error, attempted fixes and diff. Stop and ask Chris to
   select Sol Medium; resume only after the switch protocol in MODEL-BATCHES.
   Do not weaken assertions or silently call another model.
7. No parallel agents or overlapping file edits unless explicitly authorized.
8. Update task status and HANDOFF with exact evidence once. Stop/report at
   each release boundary as AGENTS requires. Keep unblocked work moving when
   an owner input only affects future activation.

## Paste into a coding session

```text
Work only in christcr2012/appliance-desk. Follow docs/plans/overhaul/
MODEL-BATCHES.md and resume the authorized batch/card recorded in
EXECUTION-STATE.md. TASKS.md supplies acceptance criteria; DESIGN.md supplies
screen and system specifications. Complete ready work with the current batch's
model, one bounded PR at a time. Do not execute the entire backlog at once.

MODEL GATE: Before implementation, verify the required model from trusted
runtime information or Chris's explicit confirmation. When a different model
is required, update EXECUTION-STATE and HANDOFF, tell Chris the exact model
and reasoning setting to select, then STOP. Resume after he confirms the
switch. Never silently substitute a model or spawn one to bypass this gate.

Read AGENTS.md and the latest docs/HANDOFF.md first. Check current branch,
main, open PRs and docs/OWNER-INPUTS.md. Do not overwrite another agent's
work. PR #86 may still be pending; verify before assuming launch code exists.

This is an incremental improvement, not a rewrite. Preserve the Evergreen
brand, existing domain actions, role checks, rental lifecycle, financial
rules and working tests. Follow the installed Next.js version's bundled
documentation before editing framework code. Reuse current components.

Before changing code, state the scoped outcome and acceptance checks in
at most 8 lines. Implement only this task or its explicitly named subcard.
If another prerequisite is missing, record it rather than silently building
a second feature. Use a branch ai/<tool>/overhaul-<actual-task-id>; never commit main.
Follow PR-STACK.md: branch from the immediately preceding PR's current head
and target its branch. Each PR must build on the previous one. Keep a stack
manifest with exact SHAs, checks and previews. Claude must review the entire
selected stack, including the cumulative diff, before ANY PR is merged.
Do not count your own review as Claude approval or auto-merge anything.

A data-changing preview must be isolated from production at build AND
runtime. Never run fixtures/reset scripts against the shared production DB.
No fake data, placeholder logic, fake success, customer messages, live payment
activation, purchased services or destructive data changes.

Test real behavior, relevant permissions and failure/concurrency cases.
Run the required type/lint/test/build/accessibility CI gates and get a preview.
For UI, check 360/768/1440px, keyboard and light/dark mode. Check the whole
changed flow, not just a render. Do not disable existing tests to pass.

Update HANDOFF and the task ledger with files, verified commit, CI/preview,
what is incomplete and any owner-input IDs. Open a PR. Do not auto-merge or
start the next release. Report in plain English: what changed, how verified,
what Chris needs to review, and the next eligible task. If the same failure
survives two focused fixes, follow the explicit Sol switch checkpoint before
continuing. End each batch with the next-model instruction, not unrequested
work on the next batch.
```

No task number needs to be chosen by Chris: start/resume from EXECUTION-STATE.
The agent selects the next dependency-ready card within the authorized batch.
Do not skip environment/security gates to start visible UI. At phase review
stops that do not change models, say “Keep the current model.”

## Reviewer prompt (Sol)

```text
Review this task's diff against AGENTS.md, its TASKS.md acceptance criteria,
and the relevant business rules. Check regressions, role/data isolation,
financial/inventory invariants, error states, accessibility, migration and
preview safety. Cite concrete file locations. Do not redesign or add scope.
Fix verified defects within the card; otherwise report no blocking findings
and the evidence still required. Approval does not merge or enable services.
```

## Google Workspace work belongs in the Claude handoff

Read [CLAUDE-WORKSPACE-SETUP.md](CLAUDE-WORKSPACE-SETUP.md). Chris reports Claude
has the required connector. Keep Sol/Luna app batches intact; give Claude exact
Workspace dependencies and receive verified non-secret settings back. Before
marking an email or Google integration complete, document every required Admin,
Gmail, Drive, Calendar or other Workspace setup step with a GW ID, owner inputs,
verification and reversal. Do not assume app code or plugin connection applied
external settings. Alias creation starts with verification of existing aliases.


### Current Codex merge policy (2026-09-30)

The owner now authorizes Codex to merge its own verified PRs as it goes;
the earlier separate Claude-review/owner-merge hold is superseded for those
PRs. See PR-STACK.md's latest authorization entry. CI, exact-head review,
applicable preview evidence, model/phase checkpoints and activation/data/spend
approvals still apply. Claude retains O01 ownership.
