> **RETIRED DOCUMENT — reference only.** Moved to `docs/archive/` on 2026-10-02.
> Nothing in this file is a current instruction; any "current", "next" or
> "supersedes" language below is historical. The working documents are
> `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md` and `docs/PLAYBOOK.md`.

## Current owner batching instruction — 2026-10-01

Chris requires far fewer, much larger PRs because each PR repeats full CI.
Use [REMAINING-BATCHES.md](REMAINING-BATCHES.md): five substantial remaining
batches, with at most one conditional Google follow-up if external gates lag.
This supersedes small card/file/page-family/report/cron/integration PR splits
and old model/phase-stop schedules. Keep one agent/current model, acceptance
criteria, O02 and other dependencies, full batch CI/preview and separate live,
spending/destructive approvals. Audit implementation follows the original
roadmap. No planning-only PR: include this checkpoint with batch 1 code.

## Owner sequencing update — 2026-10-01 (current)

Chris explicitly requested completing and merging the existing green PRs, then
continuing the original roadmap. Implementations from all audits, including
historical review repairs and B01–B36, are deferred until after the roadmap.
This supersedes earlier audit-before-feature and audit-expanded launch sequencing
in this document and linked plans. Preserve the audit registers and unresolved
findings for that later work; deferral is not resolution. Preserve existing
correctness protections, O02/O13/O14/O32 dependencies, CI/preview acceptance and
separate approvals for live activation, spending and destructive real-data changes.

# Completion plan — 2026-09-30

This entry supersedes the earlier model switching, eight-file limit and
release-by-release implementation pauses. Chris asked to finish the approved
work at high quality with minimal repeated reading/testing and no more model
switching. Continue with the currently selected model, single agent, coherent
PRs. On 2026-10-01 Chris authorized agent merges when safe and proceeding without
automated review when unavailable; record the waiver and exact-head inspection.
Full CI and applicable preview checks remain required. Existing acceptance criteria and
separate approvals for activation, spending and destructive changes remain.

## Current priority — 2026-10-01

#105/#116 verified merged. All original 108 PRs/36 submitted reviews inventoried;
91 historical unresolved threads tracked in the reconciliation ledger. Repair valid
findings against current behavior before features. #117–#129 work PRs merged at
exact heads after full CI and ready preview; current main
da3cf4243686805195640f9dd3293e38a8621e61. #127 records B01–B36 business/renewal
scope, CI 36880648787 (860/138); #128 repairs webhook atomicity, CI 36881617240
(867/138) including seven real DB race/rollback/ACH/refund cases. #129 verifies
existing portal equipment/deposit fixes, CI 36882411929 (878/138). Published blobs
and prospective main trees checked. Automated quota waived by Chris October 1.
Forty-six resolutions (forty-three historical + three #117); forty-eight historical
remain. #130 price-save/metadata under full CI, three related threads still open.
Security audit session shape/archive P1 follow-on has denied-default tests; full
security audit, provider capacity and whole-card acceptance remain incomplete.
Preserve full O02 storage/isolation, O13/O14 assignment/schema and O32 sequence.
Same model/single agent; live/spending/destructive approvals remain distinct.

## Expanded owner business scope — 2026-10-01

Chris supplied a comprehensive 33-item operational/business audit, then added
customer renewal, early termination fees and optional auto-renewal (B34–B36). He prefers all
outcomes completed before launch. [Business audit reconciliation](../../reviews/2026-10-01-business-logic-audit.md)
tracks B01–B36, existing evidence, missing acceptance, policy inputs and dependencies.
This is approved planning scope, not a claim that the audit's "missing" assertions
are all current defects. Existing late-fee automation, statements, consent records,
phone staff work and nonnegative parts require verification rather than duplication.

O31 launch acceptance now includes all B01–B36, or an explicit owner-approved
scope change/deferment. Billing essentials include staged isolation, drift
reconciliation, stored signing/invoice artifacts, consent provenance, tax boundaries,
refund/unused-term policies and outage recovery. Historical review repairs and the
security audit P0 remain first. O02 must finish before schema/storage/assignment
work; O13/O14 and O32 sequencing remains unchanged. O29 still requires actual data.
Backdated billing without delivery, automatic reservation release, refund/retention
policies and paid provider choices require concrete policy review. This audit does
not authorize live collection, spending or deletion of real data.

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

## O19 fleet/asset report subcard — automated acceptance passed in #133

Fleet and appliance detail explain assignment-based rental value, recorded costs,
contribution, cost recovery and utilization. Explicit zero costs are known; null
acquisition or either missing completed-repair cost keeps recovery unknown, with
exact supporting repair links. Full-fleet totals are independent of a paginated
25-row incomplete-cost filter. Existing 30-day rate proration and full shared-job
cost allocation remain unchanged and disclosed; no collected-profit claim.
Focused numerical, missing/zero-cost, authorization and pagination behavior tests
pass. Real disposable browser/mobile/theme/axe coverage passed in CI 36897635675
(902 tests / 144 browser checks); READY exact-head preview, six screenshots
inspected and #133 merged. No schema/provider change. Growth/source and
whole-card/manual acceptance remain.
