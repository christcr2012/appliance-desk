# Completion plan — 2026-09-30

This entry supersedes the earlier model switching, eight-file limit and
release-by-release implementation pauses. Chris asked to finish the approved
work at high quality with minimal repeated reading/testing and no more model
switching. Continue with the currently selected model, single agent, coherent
PRs, owner merges after passing checks. Existing acceptance criteria and
separate approvals for activation, spending and destructive changes remain.

## Current priority — 2026-10-01

#105/#116 are merged into main d7c1034. All 108 PRs/36 submitted reviews were
inventoried; 91 unresolved historical threads are tracked in
`docs/reviews/2026-10-01-review-reconciliation.md`. Reconcile them against current
code and repair valid defects with behavior evidence before new backlog work.
CRM #117 and purchasing #118 are under review; email outcome repairs prepared.
Codex exact-head review requests are blocked by its usage limit; CI/preview alone
do not authorize merge or thread resolution. No threads resolved.
Preserve O02 storage/isolation and O32 sequencing; no model changes.

## Execution

1. CRM: O07/O08 and O11 property prefill. Reuse existing actions; bounded
   selected-tab reads, stable cursor history, scoped property selection,
   derived estimate/task filters. Tests include equal timestamps and roles.
2. Owner control and customer experience: eligible O21 section-specific saves,
   O18 statement presentation, O20 task-first portal; preserve existing cents
   arithmetic and customer scope. O12 draft/progress UI reuses rental actions.
3. Finish O02 infrastructure evidence before O09/O13/O22/O24–O28 schema work.
   Verify isolated hosted runtime fixture and independent preview file store.
   Current production and preview providers must remain protected; no invented
   configuration proof. Upgrade/empty-schema gates already exist in CI.
4. Operations: O09/O10 task assignments, O13/O14 dispatch, O15/O16 field/assets,
   O17A purchasing and O19 report definitions/drill-through. O17B optional
   reorder points only when its contract is justified.
5. Growth: O22/O23 website revisions/editor, O24/O25 run visibility,
   O26–O28 sender pilot/events. Preserve existing dedupe/unknown-outcome rules.
   O29 CSV import remains conditional on an actual dataset/demand.
6. O30/O31 complete regression/capacity/recovery evidence, owner guide and
   launch inputs. Human walkthrough/screen-reader checks and live activation
   are distinct from automated acceptance and remain explicit.

## Token and CI discipline

Read authoritative instructions once; thereafter read only changed code and
applicable acceptance sections. Keep a short current ledger instead of another
append-only history dump. Use schema/actions/components already shipped.
Run focused tests during edits, a broad local suite before submission, and the
existing full database/build/browser/axe CI once per coherent batch. Investigate
specific failing assertions; never weaken checks or switch models. Work on the
next eligible independent batch while CI runs; repair/rebase dependencies when
needed. Do not claim a whole card complete from a partial implementation.

## Current evidence and remaining scope

| Cards | State | Evidence / remaining gate |
|---|---|---|
| O00 | VERIFIED documentation baseline | Existing source-linked plan |
| O01 | Automated evidence passed | #96/#99 CI role, payload and upload-denial checks; manual acceptance remains explicit |
| O02 | IN_PROGRESS | DB target guards, provider suppression and populated migration proof shipped; hosted fixture/file-store proof still incomplete |
| O03–O06 | Implemented, automated checks passed | #100/#101 merged; #101 head d9e526a8165772e5cbd1fad8c2ae0d42f052033c CI 36778920651 successful; owner/manual review unclaimed |
| O07/O08 | Merged, automated evidence passed | #102 head 883a8f90a21135902450fff8c4e6663b631fdeae, CI 36784399079 successful; preview READY; 24 CI screenshots inspected; owner acceptance pending |
| O11 | IN_REVIEW subcard | Validated property prefill and upcoming-job context; no new unit hierarchy or property-level request ownership claim |
| O09/O10/O13/O14 | BLOCKED contract dependencies | Require full O02 gate; task-list presentation already shipped without assignment |
| O12/O18/O20/O21 | Application subcards automated checks passed | #103: 726 tests/122 browser checks; #108: 744 tests/123 browser checks. READY previews; saved-builder/product screenshots inspected. Whole-card/manual/capacity acceptance remains explicit |
| O15–O17/O19 | Remaining | Operations depend on O13/O14; report families follow verified money presentation |
| O22–O28 | Remaining / schema dependencies | Require O02 and relevant prerequisite cards |
| O29 | DEFERRED conditional | No actual import dataset supplied |
| O30/O31 | Remaining | Whole-flow, capacity/recovery, owner/manual evidence and launch inputs |

## CRM verification boundary

The new customer page fetches identity then the selected owner tab; STAFF
continues through the existing narrow operational view without owner queries.
History fetches at most 26 records per source and uses (time, source, id) cursors.
Linked-record ID scope, property/contact rollups and linked tasks are not a
measured large-account benchmark. Service shows ten requests with an independent
full count and an explicit queue link. Property selection rejects another
customer's address; real write-action validation remains authoritative.

Lead list previews contain no note bodies. Status/search/next-action filters
share count/page predicates; 25 rows and one quote/task/note-date per lead.
A conditional transaction stage claim prevents overlapping conversions from
creating duplicate properties/audits. Account invitation behavior is preserved.
No migration, live fixture, provider activation or infrastructure mutation.

Rollback: revert the CRM PR through a PR; no database rollback is needed.

## Owner/portal verification boundary

Settings writes whitelist the selected section and save its audit in the same
transaction. Local action/form retry tests pass; real failed-audit rollback and
session-derived A/B portal reads are included in CI, not claimed passed locally.
The portal home reads customer-visible fields only, with six active rentals and
separate full counts. Existing full rental/statement history remains unchanged.
Pickup uses the existing manual request action and ownership checks; it does not
create a cancellation, refund, automatic pickup job, or billing change.

Agreement progress is a subcard only: signature, required deposit, current
assignments, completed delivery and started/blocked billing are independent.
Durable builder checkpoints and draft-save retry recovery are implemented in the third batch; real database/browser/preview acceptance remains pending.
Money presentation preserves existing cents/statement source calculations; no
new ledger or provider writes. Revert the PR for rollback; no migration.

## Rental recovery batch — 2026-10-01

Existing agreement IDs enforce actor-scoped draft-save deduplication without a
migration. Draft/audit transaction, replay-term checks, server resume DTOs,
read-only saved terms and actual discounted cents are implemented. Job and
rental writes enforce property/customer context. Local 709 tests/typecheck pass;
lint zero errors/two existing warnings. Real concurrent/rollback/foreign-property
DB proof and six width/theme saved-builder browser checks await CI. O12/O11
whole-card completion and O02 infrastructure gates remain explicit.

First rental batch CI 36813353081: 742 tests and build passed; 121 browser
checks passed including six saved-builder widths/themes. Two inherited settings
phone checks failed from absolute screen-reader labels escaping their table
scroll area. Relative containment repair shared with #103; final CI pending.
Keyboard Back now activates the real saved review transition. Additional line/
signature lost-response tests preserve input and avoid false success messages.
Preview branch Neon reports storage enabled but no buckets; this is not app
private-storage/runtime evidence and does not satisfy O02.

## Revenue family — 2026-10-01

O19 revenue definitions/backing records implemented, CI pending. Rates are
estimates; succeeded invoice payments are gross recorded amounts, not rent or
profit. Refunds and deposit refunds have separate sources. Consistent UTC bounds,
partially paid overdue balances, future/boundary trend fixes and owner-only
repeatable-read count/sum/25-row invoice drill-through. 717 broad local tests plus
one dashboard fixture test pass; real DB/browser proof awaits CI. Other report
families (earnings, asset costs, growth/source conversion) remain unfinished.

## Verified source checkpoint — 2026-10-01

#103 head 4addf2f passed CI 36815045153; #108 head ed797c7 passed
36815060816; #109 head 6a9b923 passed 36815637476 (752 tests and
129 browser checks). Each preview READY; hosted protected interaction unclaimed.
Cash export follow-on removes duplicate positive Deposit liability rows: invoice
and estimate deposits are already real Payment cash. Refund outflows remain.
Eight focused tests/typecheck pass; added real webhook fixture reconciliation,
full CI pending. Other O19 report families remain; O02 infrastructure and
O30/O31 whole-flow/manual/capacity evidence are not complete.
