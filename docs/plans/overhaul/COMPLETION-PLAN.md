# Completion plan — 2026-09-30

This entry supersedes the earlier model switching, eight-file limit and
release-by-release implementation pauses. Chris asked to finish the approved
work at high quality with minimal repeated reading/testing and no more model
switching. Continue with the currently selected model, single agent, coherent
PRs, owner merges after passing checks. Existing acceptance criteria and
separate approvals for activation, spending and destructive changes remain.

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
| O07/O08 | IN_REVIEW | CRM batch: 668 tests in 88 non-Postgres suites, typecheck/lint pass; own full CI/browser/preview pending |
| O11 | IN_REVIEW subcard | Validated property prefill and upcoming-job context; no new unit hierarchy or property-level request ownership claim |
| O09/O10/O13/O14 | BLOCKED contract dependencies | Require full O02 gate; task-list presentation already shipped without assignment |
| O12/O15–O21 | Remaining / dependency-ready portions next | Existing core behavior preserved; overhaul acceptance not complete |
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
