# Appliance Desk overhaul — start here

## Current execution override — 2026-09-30

Chris requests completion of the approved work with the current model and no
more model switching. Larger coherent PRs and continued eligible work supersede
the earlier switch/phase-stop/card-size schedule. Acceptance, CI/preview and
separate activation/spending/destructive-change gates remain. The current
sequence and evidence ledger are in [COMPLETION-PLAN.md](COMPLETION-PLAN.md).
Earlier model and stack instructions below are historical where superseded.


Prepared 2026-09-30 for Chris Robinson. This is a complete planning handoff,
not a claim that the redesign or new features have been implemented.

0. [Model batch schedule](MODEL-BATCHES.md) and [resume checkpoint](EXECUTION-STATE.md):
   authoritative execution order, exact models and mandatory switch instructions.
   [PR stack rules](PR-STACK.md) require each PR to build on the previous one
   and Claude to review the complete selected chain before any merge.
1. [Design and system specification](../../plans/overhaul/DESIGN.md): current-state audit, navigation,
   brand/UI rules, detailed screen layouts, backend contracts and release scope.
2. [Implementation cards](TASKS.md): 32 ordered tasks with dependencies, file
   entry points, model assignment, acceptance checks and release gates.
3. [Implementation prompt and model guide](IMPLEMENTER.md): paste-ready task
   prompt, review prompt, token/cost controls and verified model guidance.
4. [Owner inputs](../../OWNER-INPUTS.md): mailing address, reply/public email,
   phone, release decisions and other inputs; known facts are not asked again.
5. [Google Workspace connector](../../plans/overhaul/GOOGLE-WORKSPACE.md): identified repository,
   deployed MCP URL, connection steps and what remains unverified.
   [Claude Workspace setup register](../../plans/overhaul/CLAUDE-WORKSPACE-SETUP.md): Admin alias
   verification/creation, inbox and email setup, conditional Drive/Calendar work,
   required owner inputs and completion evidence.

Recommended approach: preserve the working application and replace the most
painful interactions first. Finish foundation and daily-use releases A/B
before spending time on optional imports, advanced automation or new integrations.
The plan is tailored to an owner working long shifts, often using a phone.
It does not make Chris choose technical details a competent implementer can decide.

User-requested execution: five batches, **Sol Medium -> Luna High -> Sol Medium
-> Luna High -> Sol Medium**. The assistant saves its handoff and tells Chris
when to switch, then waits before continuing. If a phase review keeps the same
model, say so. No new subscription or API spend is authorized here.

PR #86 contains a separate, already-tested prelaunch signup/email feature.
Check its current merge state before implementing anything that depends on it.
This planning PR stacks on #86 and adds documentation only to its predecessor.

B1 began 2026-09-30 with Sol Medium. [Baseline evidence](BASELINE.md) records
O00 reconciliation; EXECUTION-STATE tracks actual completion separately.


### Current Codex merge policy (2026-09-30)

The owner now authorizes Codex to merge its own verified PRs as it goes;
the earlier separate Claude-review/owner-merge hold is superseded for those
PRs. See PR-STACK.md's latest authorization entry. CI, exact-head review,
applicable preview evidence, model/phase checkpoints and activation/data/spend
approvals still apply. Claude retains O01 ownership.
