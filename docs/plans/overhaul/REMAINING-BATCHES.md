# Remaining roadmap — five substantial PR batches

Current owner instruction, October 1, 2026: stop small PRs and repeated full
validation cycles. This replaces card-per-PR, eight-file limits, separate
contract/UI PRs, one-report-family-per-PR, one-cron-per-PR, six Google PRs and
historical model/phase switching instructions. Keep the current model and one
agent. Acceptance criteria and infrastructure/business dependencies remain.
Implement audit recommendations only after the original roadmap.

## Verified starting point

Main includes merged #130–#133. #133 head
abe3f800b9a413d1db2816ece92a757416300407 passed CI 36897635675:
902 unit/integration tests and 144 browser checks. Six report width/theme
screenshots inspected; preview READY at that head. Main merge:
d13c112753a95e00450636c4891fe1c0236592f0. Protected hosted-page/manual
acceptance is not claimed.

Do not rebuild shipped navigation/Today/CRM tabs, durable rental recovery,
invoice/statement presentation, portal home, section-specific settings saves,
revenue report or fleet report. O00/O01/O03–O08 have implementation/automated
evidence; owner/manual and measured-capacity acceptance belongs in batch 5.
Partial cards mean finish remaining contracts, screens or proof.

## Planned PRs

| Batch | Remaining cards | Complete outcome | Dependency / completion boundary |
|---|---|---|---|
| 1 — Safe foundation and assigned follow-up | O02, O09, O10, remaining O11 | Prove preview DB/runtime/private-file isolation; deliver assigned/prioritized/versioned tasks, Mine/Unassigned/Team views, linked follow-up and remaining property context together | Finish O02 hosted fixture and independent storage proof before dependent schema. Preserve team-shared visibility; no new property/unit hierarchy |
| 2 — Rental-to-service operations | Remaining O12, O13–O16, O17A; justified O17B only | Job assignee/duration/conflicts with dispatch UI; field checklist/photos/maintenance linkage; appliance record tabs/history/parts; supplier/part/PO receiving usability; remaining rental progress/context | Batch 1 accepted first. Prove rental → scheduled delivery → service → return; preserve lifecycle, receiving, money and checklist policy |
| 3 — Owner/customer workspaces and website | Remaining O18–O21, O22/O23 | Earnings/source/growth definitions and supporting records; remaining portal/money/settings screens; website revisions/editor/draft preview/publish/rollback | O02 before revision schema. Contract and UI together. Public promises use confirmed inputs; no integration activation |
| 4 — Automations and communications | O24–O28, O32 when prerequisites verified | Run history/health UI; staged cron instrumentation; durable message ledger pilot, record visibility and provider reconciliation; consolidate eligible Google calendar/Drive/Gmail work | Establish durable contracts before dependent senders/events in ordered commits. Preserve dedupe/unknown-outcome tests. Google needs walkthrough, connector prerequisites, credentials/OAuth folder proof |
| 5 — Integrated verification and owner handoff | O30/O31 and remaining whole-card proof | Full business scenarios; measured large-list/capacity/recovery checks; owner guide/runbook/input register and release-readiness evidence | Depends on implemented batches. Human walkthrough/screen-reader and live release remain explicit owner steps. Audits are subsequent work, not hidden in this batch |

Target: **five remaining PRs**, not one per card, page, cron, integration step,
test repair or documentation update. Multiple files and ordered implementation
commits are expected. Inspect/test each contract before dependent work, then
submit the whole reviewable batch.

O32 is the sole likely conditional extra PR: if external setup/walkthrough
prerequisites remain unavailable when batch 4 is ready, ship its complete
non-Google outcome and mark O32 blocked. Once ready, put all authorized Google
integration into one follow-up PR, rather than six. Target five, with at most
one dependency-driven addition; do not invent setup proof or hide missing
behavior in a flag. O29 stays deferred without a real import dataset. O17B is
conditional, not a reason for another small PR.

## Validation and publishing discipline

- Use local commits and focused behavioral tests while iterating. No full-suite
  run per edit or completed card.
- Integrate schema, actions, UI, recovery/error handling and documentation before
  opening the PR. One acceptance matrix and complete user flow per batch.
- Run broad local checks once when ready. Keep full required PR CI: disposable
  Postgres, migration/upgrade, type/lint, build, browser and axe. Do not trim
  coverage to compensate for small PRs.
- Push a consolidated ready batch. Diagnose CI failures, consolidate repairs
  and verify locally before another push; repair the same PR. Retry only failed
  jobs for transient infrastructure failures where supported. Code changes
  still need their required checks.
- Reuse review inventory and inspect new findings/changed source, not unchanged
  history. Audit backlog implementations remain deferred.
- Inspect exact published head, require full CI and applicable preview/acceptance
  evidence, then merge with expected head SHA. Keep sequential dependencies;
  avoid a growing stack of unfinished small PRs.
- Include this plan, final #130–#133 evidence and HANDOFF in batch 1.
  **No standalone planning/documentation PR or full CI for this checkpoint.**
  Record post-check evidence in the PR review/body without another code push
  solely to change a status sentence.

## Batch 1 current checkpoint

Hosted database and application private-file isolation proof passed on October 1;
original store Production-only, owned fixtures cleaned up. O09/O10 and O11
property context integrated locally for one batch PR. Final CI/preview acceptance
is pending; see PREVIEW-ISOLATION-PROOF.md and HANDOFF.md. The infrastructure
blocker described below records the earlier state, superseded by that proof.

## Earlier blockers and safe progress

O02 has target guards, separate preview DB metadata, non-sending preview mode
and migration/upgrade tests. Missing proof: hosted disposable runtime fixture
absent from production plus independent private file storage/workflow. A ready
build or storage-enabled branch without buckets does not establish that proof.
Dependent schema stays blocked until this gate. Verify existing project
resources before configuration changes; no purchases or production cleanup.

Public-contact/legal/launch choices and live activation remain owner inputs.
Continue isolated reversible implementation under existing approved rules; no
invented public promises or real payments/messages. Google retains identity,
folder authorization and walkthrough gates. Preserve audit registers and open
findings for work after the roadmap.
