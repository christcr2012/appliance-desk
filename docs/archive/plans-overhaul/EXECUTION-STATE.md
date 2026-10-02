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

## Current checkpoint — 2026-10-01

Main d13c112753a95e00450636c4891fe1c0236592f0 contains merged #130–#133.
Next branch: ai/codex/roadmap-foundation-and-tasks. Batch 1 scope/proof is in
REMAINING-BATCHES.md. These checkpoint docs will ship with implementation,
not another small PR. O02 hosted runtime/private storage proof is incomplete;
dependent schema stays blocked. No unique unfinished application changes were
found in the preserved earlier workspaces. Older entries are evidence history,
not the current PR schedule.

## 2026-09-30 — Owner and portal workspaces; CRM checks green

PR #102 head 883a8f90a21135902450fff8c4e6663b631fdeae passed full CI
36784399079, including migrations, real Postgres tests, build, browser/axe.
Preview dpl_n26WQFDuVoQfEsHGpfYV4oBAY12E is READY. First run caught an
unlabelled linked-task date field and a browser Back/navigation race; labels
and awaited URL transitions fixed them without weakening checks. Inspected all
24 CI screenshots; tablet title cramped beside actions, fixed in the next batch
with a minimum title-column width. Owner merge/manual walkthrough unclaimed;
preview protection fetch redirects.

Second coherent batch implements O21 focused sections/saves with field
whitelists, strict booleans, atomic settings+audit, guarded actions, retry
feedback and non-secret provider configuration status. O18 invoice/statement
presentation fixes All invoices retaining its filter, links exact documents,
uses stable narrow invoice reads, distinguishes invoice money from rental
revenue, and improves phone wrapping. O20 home resolves identity from the
session with bounded customer-visible DTOs, property filters, recorded visit,
open invoice and problem/pickup paths. Pickup reuses the reviewed manual
request lifecycle and never automatically cancels or charges. O12 progress
subcard separates signature/payment requirement/equipment/delivery/billing.
Full durable builder save/resume remains incomplete.

Local: 694 tests in 96 suites pass (four existing DB suites excluded; the new
CI-only real rollback test skips locally). Typecheck pass, lint zero errors/two
existing warnings. CI contains real rollback and customer A/B home tests plus
360/768/1440 light/dark screenshots/axe, settings save/reload/back, exact billing
links and pickup persistence. Second batch full CI and preview remain pending.
No schema, live fixtures, message/payment activation or infrastructure changes.
Rollback is PR revert. COMPLETION-PLAN.md remains the concise complete ledger;
O02 hosted fixture/private storage gate and dependent schema cards remain open.

## 2026-09-30 — CRM workspaces and completion execution

Owner requests all approved work, high quality, minimal tokens, no further
model switching. COMPLETION-PLAN.md is the concise current sequence/ledger;
older model/phase pauses are superseded, acceptance and activation gates are not.
Main 7050f998 includes merged #101; its head d9e526a8165772e5cbd1fad8c2ae0d42f052033c
passed CI 36778920651. Recovered interrupted customer helpers and reviewed them.

Built O07/O08 and O11 property-prefill subcard: link-based customer tabs with
selected-tab reads; preserved STAFF operational view/actions; stable paginated
note/activity history with author/time/entity links; real property context and
validated preselection for rental/job forms; lead status/search/derived quote
and no-open-task filters; linked estimates/tasks/customer action; conditional
transactional conversion claim prevents duplicate property/audit writes.

Local evidence: 668 tests in 88 non-Postgres suites pass, including 137 equal-
timestamp history records without omissions/duplicates and selected-tab/role
checks. Typecheck passes; lint zero errors/two existing warnings. Four existing
Postgres suites require CI; new browser tests cover record tabs/property
prefill/note persistence/lead URL navigation, 360/768/1440 light/dark and axe.
Own full CI/preview/screenshot review remain pending; no owner or manual
screen-reader approval claimed. No schema, production fixtures, providers or
infrastructure configuration changes. Rollback: revert PR, no DB rollback.

Remaining: full O02 runtime fixture/independent file-store proof; O11's richer
property request context; assignment/scheduling/revision/automation contracts
and subsequent operations, money, portal, settings, growth and O30/O31 gates.
Do not call the entire project finished. Continue the next eligible batch
while owner merges green PRs.


## 2026-09-30 — Daily workspace implementation (Astra Medium)

Owner switched to Astra Medium and requested larger coherent batches,
superseding the older Sol/Luna schedule. This batch combines O03 semantic
actions/surfaces/control borders, O04 used page/list primitives, O05 grouped
responsive navigation and O06 Today with the non-assignment task-list work.
No schema changes or dependency on incomplete O02 storage isolation.

Built: all 23 existing owner/admin destinations grouped with shared server
role filtering (12 staff links); desktop scrollable sidebar; native modal
phone/tablet drawer with Escape/focus restoration and internal scrolling;
Today/Tasks/Jobs/More shortcuts; search and permission-aware Create menu.
Today now uses America/Denver day bounds, including 23/25-hour DST days,
shows next visit, active schedule, collapsed completed work, due tasks,
operational metrics and specific exception-resolution actions. Cancelled jobs
are excluded from active counts. Existing exception and finance guards remain.

Tasks remain team-shared. Add URL due-date filters, stable 25-row pagination,
six-record Today preview with independent full counts, date-only deadlines,
validated calendar input, accessible labels, save failure preservation and
explicit removal confirmation. No assignment/priority/schema feature is
claimed. Linked-record deadline labels use the same calendar representation.

Evidence: 647 tests in 84 non-Postgres suites pass; two additional Today
rendering tests also pass (649 tests across 85 non-Postgres suites total). Full typecheck passes; lint
has zero errors and two pre-existing warnings. New CI browser checks cover
owner/staff navigation, focus/scroll/Escape, task create/complete/filter
back-navigation and 360/768/1440 light/dark axe plus attached screenshots.
These browser checks, database suites, preview visual inspection and owner
walkthrough are PENDING, not claimed verified.

Predecessor #99 merged as 21439bb0dd3720a97a4007ffac6c96ed042104bf; its CI
36752290196 and Vercel status succeeded. This PR starts on that main baseline.
Remaining foundation: O02 hosted disposable runtime fixture and independently
verified preview file storage. O09/O13 schema work remains blocked on that
gate. O07/O08/customer and lead redesigns are not part of this batch.

# Overhaul execution checkpoint

Updated: 2026-09-30

| Field | Current value |
|---|---|
| Baseline | main d504acab65c7029ebbfe8307a38444979da6e997 |
| Historical stack | #86/#87/#88 merged; #89 closed unmerged; #90/#91/#92 merged |
| Current branch | ai/codex/foundation-role-and-preview-safety |
| Batch | B1 IN_PROGRESS; existing Sol Medium schedule; no model switch |
| O00 | VERIFIED documentation baseline |
| O01 | Reassigned to Codex by owner; grouped foundation fix IN_REVIEW pending full CI/browser proof. |
| O02 database | Separate vercel-preview-2 branch and recorded READY deployment observed; full-card proof incomplete |
| O02A | PR #93 merged; final-head CI 36733312755 passed (525 unit/integration, 55 browser/axe); production READY |
| O02 remaining | Environment-target/build/runtime fixture proof; verified independent preview file workflow; complete migration evidence |
| O09/O13 | Blocked until O01 and complete O02 gates pass |
| Authorization | Owner asked Codex to work around Claude's O01 pause; independent O02 subcard selected |
| Merge gate | Codex exact-head review + passing CI/applicable preview evidence; owner authorized Codex to merge its PRs as it goes on 2026-09-30 |
| Owner inputs | docs/OWNER-INPUTS.md |

O02A suppresses Vercel non-production email/SMS, requires Stripe test keys and
refuses live webhook events, and blocks upload token minting/backup reads,
writes and pruning until separate preview storage is verified. No environment
variables, credentials, customer data or paid resources changed.
This supersedes the stale #87 pointer. Check the remote tip before any next PR;
preserve Claude's O01 work. Do not call the whole O02 card complete.


## 2026-09-30 — Owner authorizes Codex merges

Chris explicitly changed the earlier merge arrangement: Codex may handle
merging its own PRs as it goes. For Codex-owned PRs, the earlier separate
Claude-review/owner-merge-approval hold is superseded. Codex reviews the exact
head, requires passing CI and applicable acceptance/preview evidence, and
merges through a PR with an expected-head SHA. No direct main commits.
Claude still owns O01. This authorizes no paid resources, live payment/email/
SMS activation, destructive data changes or automatic next-phase work.
Model-switch and product release checkpoints remain in effect.


## 2026-09-30 — Backup export coverage repair (Codex)

The existing JSON exporter omitted 10 current business tables: LeadNote,
StaffTask, Supplier, PurchaseOrder, PurchaseOrderLineItem, Estimate,
EstimateLineItem, LaunchSettings, LaunchSubscriber, and LaunchDelivery.
This bounded B1 correctness repair adds all 10, bringing the export to 41
business tables. A typed schema-wide policy requires a decision for every
Prisma model; independent schema-derived tests verify records, exclusions,
and failed-read behavior. Existing private storage, retention, JSON shape,
and non-production suppression remain in place. No migration or live backup
was run. Existing backups are not retroactively repaired.

Account credentials, Session, Verification, and WebhookEvent retain their
existing exclusions; credentials are not automatically regenerated by login.
This is a business-record export, not complete disaster recovery: file bytes,
credential recovery, snapshot consistency, and a JSON restore drill remain
separate work. Local focused tests: 33 passed; typecheck passed. Exact-head
full CI and preview evidence are tracked in the associated PR before merge.
Claude continues to own O01; full O02 and O09/O13 remain incomplete/blocked.


## 2026-09-30 — Complete deployment schema coverage (Codex)

Bounded B1/O02 prerequisite: deployment schema verification now reads every
Prisma model, including empty tables, rather than only nine representative
tables. Generated model names automatically cover future additions. Each
query selects all scalar columns and returns at most one row; there are no
writes in the deployment check. Failures name the affected model and retain
the original cause. The existing deploy script still fails before the build
and disconnects on either outcome.

Local checks: 12 focused tests passed; typecheck and focused lint passed.
CI also runs an explicit negative test before seed: only on CI's localhost
appliance_desk_test database, temporarily drop StaffTask.note in a transaction,
require the named missing-column failure, then verify the rollback restores
successful health checks. This test is not in vercel-build. The PR records
exact-head CI/preview/review and merge evidence. No schema migration or live
negative test is performed. This proves schema readability, not every index,
constraint, database identity, or the full O02 acceptance criteria.

PR #94 already merged as f787ed07c72ae9af5d31af26fe5ef5e67daa0c72, with
527 unit tests and 55 browser/axe checks passing in CI 36736227231 and
production deployment dpl_HH4g7TuFMQrwubF9hKt7WubzXSXk READY. PR #93 is
also merged/deployed; its older draft/hold notes above are historical.
O01 remains Claude-owned; O02 remains incomplete and O09/O13 remain blocked.


## 2026-09-30 — O01 takeover and grouped foundation security PR

Chris explicitly reassigned O01 from Claude to Codex and requested progress
through the full approved backlog, with larger related PRs to reduce repeated
CI runs. The earlier instruction that Claude owns O01 is superseded. Related
foundation/security changes may exceed the older eight-file/card-per-PR
limit when they form one reviewable outcome; preserve behavioral tests and
acceptance gates. No unrelated mega-PR or direct main commits.

Chris offered to merge green PRs while Codex works on the next PR. Adopt
that workflow: Codex completes local testing and exact-head review before
handoff; owner merges only after CI and applicable previews pass. Subsequent
PRs retain predecessor dependencies and are repaired/rebased if upstream
fails or changes. O01/O02 remain IN_REVIEW/incomplete until their acceptance
evidence passes. Model/phase checkpoints and approvals for live activation,
spending and destructive customer-data changes still apply.


Built: Today excludes finance exceptions and queries for STAFF; Activity
counts/pages/summaries share a fail-closed operational-action allowlist and
omit arbitrary audit payloads; customer, agreement and appliance details
use dedicated operational selects. Staff agreement lists show status/counts
without prices or free-text rental labels. Jobs/driver/dispatch queries are
bounded operational selects; repair costs and full agreement/customer objects
are excluded from staff client props. Repair-cost writes remain owner/admin
only; operational checklist updates remain available. Fleet profitability
and finance-bearing read helpers require OWNER/ADMIN. Restricted create/export
controls are hidden, with existing real server action/export guards retained.
Search now authorizes callers and selects only its public desk DTO fields.

O02 safeguard: both DIRECT_URL (migration config) and DATABASE_URL (runtime,
before cached-client reuse) must match the verified vercel-preview-2 endpoint
on non-production Vercel deployments. Host/database/port/query-override checks
fail before connection, without logging credentials. Neon read-only identities:
project jolly-term-08991992, branch br-broad-union-b784qy62, endpoint
ep-silent-hill-b7rpraoc. Production and local/CI behavior remain unchanged.
No Vercel environment values were exposed or changed. See PREVIEW-SETUP.md.

Verification: local focused tests and typecheck passed; full local suite had
549 passing tests and only the four real-Postgres integration suites blocked
by the absent local database (30 test cases). CI is the required database gate.
CI-only guarded staff and second-customer fixtures plus signed-in Playwright
negative payload/URL/export tests, checklist persistence, customer isolation,
360/768/1440 light/dark/keyboard/axe coverage are added. Browser results are
pending CI; no production fixture or manual visual verification is claimed.
O01 is IN_REVIEW until the grouped PR passes gate G. Full O02 still needs its
runtime fixture/private storage acceptance proof; O09/O13 remain blocked.

PR #95 merged as d504acab65c7029ebbfe8307a38444979da6e997; CI36738495139
passed (532 tests, 55 browser/axe checks and actual missing-column rollback
proof). Production dpl_FnK59u7TFxTWjAecUyCfW7ZQXvFQ READY. Next work while
owner merges: O02 migration upgrade proof in disposable CI, then reassess
remaining foundations before dependent schema/UI work. Keep current B1 model.


## 2026-09-30 — Review repaired; populated migration-upgrade drill

PR #96 commit 3251be79738792b109bee47ef2db5c95d2575acb passed CI
36746611030 and Vercel; 86 browser/axe cases pass. Issue #97 scheduling
entry points now match STAFF permission boundaries and its review thread
is resolved. Owner merges that predecessor before the follow-on PR.

O02 migration-upgrade subcard adds a strictly CI-local separate disposable
database drill with original migration, synthetic existing records, full
Prisma upgrade, every-model schema reads, history/record preservation and
no-op deploy retry. Guard tests (17), focused role/list tests (13), script
lint and targeted TypeScript compile pass locally. Actual DB drill awaits
CI. Full O02's preview runtime/private storage evidence remains incomplete;
O09/O13 await the foundation gates. Keep current B1 model; no activation,
paid resource or production-data mutation.


## 2026-09-30 — O02 migration evidence green; file authorization follow-on

PR #96 merged as 39800b08038b8ba155bcff9186a063831bfee88f. PR #98 head
22777db6eff8d9acb68f51fff2eebb105eeee28b passed CI 36750017203 and Vercel,
including populated historical upgrades and deploy retry. Owner merges #98.
The follow-on photo-token boundary work preserves existing role operations,
requires valid record paths and customer-owned maintenance namespaces, and
refuses archived accounts/malformed uploads. 62 focused tests and 611 tests
in 78 non-Postgres suites pass, plus full typecheck/lint; browser/DB gate awaits
its own CI. No actual preview storage provisioning or hosted isolation fixture
proof is claimed. Full O02 remains incomplete; O09/O13 remain blocked. Current
B1 model and owner merge workflow remain in effect.

