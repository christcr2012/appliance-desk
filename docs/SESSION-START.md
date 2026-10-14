# SESSION-START — implement, then catch up released acceptance

## 0. Reconcile and recover

Read the governing instructions and the current permanent handoff, not historical
status entries as new work. Verify actual main, live, the READY production revision,
open/unfinished PRs, exact-head CI and unresolved reviews. Preserve concurrent work.
Recover your interrupted/red PR first; inspect all failures and batch their remedies.

## 1. Catch up released work before new implementation

Fetch main/live refs once. Independently verify production environment, source SHA,
READY state and origin through trusted deployment evidence. A schedule timestamp,
workflow success, matching branches or service self-report alone is insufficient.
Run `npm run session:status` for the compact queue; add `-- --deployed FULL_SHA
--state READY --latest-pr NUMBER` only with freshly verified observations. The command
is offline/read-only and never executes acceptance, releases or provider mutations.
Without a shell use the same ledger and GitHub compare/deployment evidence manually.

If main = live = READY production, catch up **every authorized pending live check**.
If they differ, still run tasks whose required revisions are included in production.
Missing/shallow ancestry needs an exact compare or targeted history fetch, not a guess.
Recheck BLOCKED tasks against current owner decisions; do not request approvals again.
A newly observed scheduled, delayed, recovery or separately authorized manual release
uses this same procedure. Do not wait for the nominal release time or initiate a release
just to finish a development batch. Follow the existing checked release policy.

## 1a. Choose a substantial outcome

Read the authoritative work index/roadmap and the highest-priority eligible card.
State its observable result and finite acceptance before editing. Read only its named
code seams, design sections and fixtures; reuse existing helpers and task/packet tools.
Group compatible operations into a complete usable workflow, including callers/tests.
Line counts are review estimates, not mandatory artificial slice boundaries. A larger
cohesive PR needs explicit integration/risk/verification coverage. Preserve actual
migration ordering, risk isolation and every business/security/financial decision gate.
Do not revisit passing hardening without a demonstrated defect or approved requirement.

## 1a. Finish the roadmap unit in order before selecting another

Read AGENTS.md's *Roadmap order, complete batches and immediate owner
escalation* rule. Start from actual main and the active work-index packet.
Build and verify the **entire current outcome**, not an arbitrary next
helper. Keep its dependencies, customer path and integration together.
Do not carry unfinished engineering to later sessions merely because it
needs more work, easier tickets exist, or a PR multiple is near.

For any perceived blocker, investigate, attempt an authorized fix and
consult existing owner decisions. If a required business choice is
missing, ask the owner directly **now**, then record the answer and
resume the selected unit. Research official law instead of asking
the owner for public facts; configurable provisional defaults allow
development while professional confirmation gates actual affected
business use. Only true external/release-dependent acceptance belongs
in the queue. A handoff is not a substitute for finishing available
implementation.

## 1aa. Ask owner promptly, research law independently

Follow AGENTS.md's permanent owner-question and regulatory-default protocol.
Read dated owner decisions before asking. If a *necessary business policy*
choice is genuinely missing, ask the smallest question with a recommended
option immediately in the current chat, keep exact re-entry context, then
resume the session when the owner answers; never archive a whole implementation
batch as blocked. Continue independently eligible development while awaiting
the answer if possible.

For legal/CPA questions, search primary public statutes, enacted amendments,
effective dates, official agency guidance and applicable home-rule rules before
planning. Implement the most grounded initial policy as provisional **editable**
configuration, store source/date/uncertainty in its existing card, and add
effective-dated revisions for verified future changes. Explicit professional
approval remains a separate, owner-clearable **business-use** gate, not an
engineering gate. An owner setting or synthetic scenario must not masquerade
as genuine CPA or counsel approval.

## 1b. Keep review-dependent development moving (standing owner rule)

Before declaring a legal, CPA, accounting or owner-interpretation blocker, split
the selected outcome into the **configurable implementation** (which continues)
and the precise **real-business-use operation** that requires review (which
must remain disabled until verified approval). This rule does not halt coding,
test execution, source merge or unrelated parts of the running business. Read the
new standing rule in AGENTS.md. Implement independent work end-to-end with stored,
validated, role-restricted, audited, and where appropriate effective-dated
configuration; test both alternative configurations and UNDECIDED fail-closed
behavior at **every real-business entry point**, including customer, owner,
API and provider paths. Internal previews must be non-actionable, clearly
provisional and barred from becoming binding customer transactions. Never
quietly freeze a provisional interpretation in code, show an unconfirmed all-in
payable amount, bypass a legal protection, or alter prior signed/billed evidence
when rules change. A configurable capability is not
approval to use it in production.

Keep the specific pending review/decision ID and the prevented operation in
OWNER-INPUTS and the work card; separately queue deployment/provider/owner
acceptance. An unresolved professional review does not block unrelated work
or source merge unless that precise review was an explicit pre-merge requirement.
When reviewed input arrives, apply and verify the setting/effective version;
do not ask the owner to reopen already implemented adjacent work.

## Roadmap-first execution: complete the current outcome

Use the work-index active packet and parent card in approved dependency order.
Finish all implementable work and regressions in the current coherent batch
before moving to a later dependent unit. Do not defer unresolved CI, fixtures,
implementation or review corrections to later sessions or split the outcome
into serial mini-PRs just to count PRs. Seek root cause and fix it here.
If an essential unrecorded owner decision truly blocks safe implementation,
ask one precise question to the human owner in this chat, record its exact
scope/remedy and resume the same task when answered. Safe configurable work
continues; CPA/legal review gates affected real-world transactions only.
Only genuine release/provider/customer/professional external acceptance may
remain queued after eligible engineering is finished. Independent parallel
work requires explicit roadmap eligibility. AGENTS.md is authoritative.

## 3. Build, verify, publish

Use focused behavioral tests/lint at meaningful seams while developing. Local commits
are recovery points, not reasons to run the entire suite or push after every small edit.
Before publishing the coherent tree, run all existing mandatory checks and applicable
unit/database/provider-shape/browser gates once. File changes invalidate affected proof.
On a shared limited runner, cap Vitest workers (for example `--maxWorkers=2`) and
run at most two full suites concurrently; preserve the same test selectors/coverage.
Batch known CI/review fixes; inspect all failed jobs before the next correction push.
While CI waits, advance the approved immediate successor; at most two unmerged PRs.
Follow existing REST/Sandbox fallbacks if local execution is unavailable; report actual
Actions evidence honestly. Merge only exact-head green checks plus required reviews.

### First-pass validation and review

Before the first publication of a coherent change, use the existing card/packet to
name each changed boundary, its proving test/fixture and the existing command that
checks it. Keep this compact; reuse the PR's verification section, not a new ledger.

- Trace inputs through the actual caller, helper/client, provider request and result.
  Verify method, path/version, scopes, query/body fields, pagination and response shape
  against the pinned schema/SDK or cited current provider contract **before** adapting
  fixtures. Test the captured outbound request; a permissive fake is not contract proof.
- Reuse realistic fixtures with required fields and relationships. Assert meaningful
  results, denied paths and applicable provider failures/ambiguous writes; prove no
  unintended call or replay. Never weaken a fake/assertion just to turn CI green.
- Search changed exports and data shapes for affected callers, fakes, DB adapters,
  catalogs and tests; update them together. Run existing repository/index/schema/catalog
  validators plus the affected behavioral tests before the full publication gates.
- Review the complete diff against the card and applicable security guide before
  opening the PR. Inspect inherited unresolved findings and all current review threads;
  record each fix or evidence-backed disposition under the repository's review rules.
  A reply alone does not resolve a finding; recheck reviews immediately before merge.
- When CI fails, collect every completed failing job/annotation and trace the root
  cause before one correction push. Reproduce with the smallest relevant existing
  command; retain a regression test for an actual behavioral defect. A repeated failure
  requires new diagnostic evidence, not another speculative fixture edit.

Record exact commands, results and unavailable checks truthfully in the PR. REST-only
sessions still inspect contracts, fixtures and the full diff before publication, then
use required exact-head Actions evidence for execution they cannot perform locally.
Do not invent commands, relax coverage or merge gates, or rerun unchanged passing checks
unless changes or new evidence invalidate them. Live proof remains in the release queue.

Use the existing `work` packet and `check:quick`/`preflight` selectors; verify
changed Prisma/domain/API/UI shapes and their fixtures together. DB/browser/build
requirements remain in PLAYBOOK; no provider or production DB replaces test fixtures.

**PR merge readiness and product acceptance are separate.** A safe implementation PR
may merge with deployment-dependent proof queued, when all pre-merge gates pass and
no explicit card/owner rule requires that proof before merge. Keep such a milestone
IN_PROGRESS/awaiting acceptance. An explicit pre-merge gate still blocks that PR; move
to independently eligible work. Never mark code/CI as deployed or real-provider proof.

## 4. Maintain one release acceptance queue

The marked JSON block in the authoritative status ledger is the running queue, not a
second roadmap. Preserve existing card IDs/evidence and reconcile older open obligations
into it before declaring the catch-up complete. Keep each task's priority, exact minimum
reviewed source revision, procedure, prerequisites, gates, last evidence and disposition.
`dependsOn` names acceptance tasks that must have recorded genuine PASSED evidence;
source implementation dependencies remain in the existing work index. Split broad seed
rows into exact scenario rows as fixtures/revisions are reconciled. No fake pass entries.
After every meaningful merge, add any new deployment-dependent checks in that PR; pin
its source commit, never a guessed future merge SHA. After a release, execute cleared
checks promptly, record sanitized read/write/denial/readback/cleanup proof, and retain
failed/uncertain fixture recovery tasks. New changes, rollback, authorization or environment
changes reopen affected proof. NEVER copy credentials/private fixture IDs into the queue.

## 5. Checkpoint and finish

Keep a short progress note on interrupted branches: head, done/proof, one next action,
CI/review state, successor and exact blocker. Diagnose and attempt authorized remedies
before deferring; isolate the operation and continue approved independent work. Limited
release frequency is planned queued acceptance, never a project-wide stop.

Normal implementation sessions deliver five substantial merged PRs including inherited
work; adjust to the next higher PR-number multiple of five using actual allocation and
recalculate for concurrency. No special six-PR rule, filler or documentation-only quota.
This owner-requested repository optimization is scoped maintenance, not a five-feature
batch. Preserve safety even when no further eligible work or an execution limit remains.
At completed-session end update status/cards/index, verify final main, leave a permanent
handoff on the final merged PR and automatically give a short continuation prompt:
repository + verified handoff + next outcome + queue pointer. Refer to the repository
for rules/order rather than recopying them. Preserve interrupted-session obligations.

## 6. Safety and specialized procedures

Governing instructions, existing PLAYBOOK/hosting rules, owner decisions and the card's
specific safety procedures remain binding. Reuse saved authorized developer connections.
Security, money-out approval, production activation, spend, isolation, exact fixture
cleanup, secret handling and all required local/Actions tests are unchanged.

## Appliance Desk execution tools

Use `npm run work -- start`, `plan`, `read`, `drift`, `verify` and `prompt` with the current packet. Preserve the existing disposable-Postgres/Sandbox preflight and per-worktree install; do not reuse shared node_modules or real database URLs. Browser/build checks remain mandatory. The continuation command produces a draft, not independent GitHub evidence.
