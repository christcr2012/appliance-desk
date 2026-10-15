# SESSION-START — reconcile, accept released work, implement, close out

## Autonomous execution contract

“Do N bundles” authorizes continuing the full documented process without routine
permission stops: reconcile → perform eligible acceptance → implement → verify →
review/merge → cleanup/handoff → next outcome until N and eligible obligations are
satisfied. Checkpoints preserve progress; they do not end otherwise feasible work.

On a terminal failure, diagnose and repair; on green CI, handle reviews and merge
when authorized. During pending CI, do useful independent scoped work, then recheck
at a meaningful transition. Repeated unchanged results require a different action,
not a busy loop. Never silently stop or imply background execution after a turn ends.

Before a blocker can justify stopping, identify its exact error/evidence, investigate
its cause, check already-recorded decisions and attempt authorized remedies. Isolate
one blocked operation and continue independently eligible work. If nothing authorized
can proceed, explain to the owner: what is blocked, why, what was tried, what specific
input/permission/resource or fix you believe would unblock it, and your recommended
next action. Ask genuinely missing owner input promptly while independent work proceeds.
An actual execution limit gets an explicit incomplete recoverable checkpoint, never
a completion claim. Preserve every real safety, spending, release and approval gate.


## Bundle target and delivery boundaries — owner correction 2026-10-15

The current owner's N counts substantial NEW engineering outcomes, not PRs or
small card remainders. Normal guides remain 2–5 completed existing subsections
and about 400–800 meaningful production lines; neither is a padding requirement,
ceiling or automatic certificate. Previously implemented behavior, reconciliation,
test volume, CI waiting and closeout do not make a small remainder substantial.

**Plan before code.** In the existing selected execution card, preserve one
`bundle-plan` JSON block (schema below). Inspect actual main and record the NEW
remaining engineering, original full acceptance for each existing approved ID,
integration boundary, honest new-work estimate and why related adjacent approved
work is included or excluded. Prefer a coherent group of whole related subsections.
Run `npm run session:bundle -- --card docs/EXISTING-CARD.md`, then commit that
card before implementation; retain the exact planning SHA. That local docs commit
is a checkpoint in the implementation PR, never a separate plan-only PR or an
owner approval stop. Do not copy the whole roadmap or plan distant bundles.

The block is bounded by `<!-- bundle-plan:start -->` and
`<!-- bundle-plan:end -->`, containing one fenced `json` object:

```json
{
  "baseRevision": "EXACT_FULL_HEAD_BEFORE_PLANNING_COMMIT",
  "outcome": "Observable coherent outcome from approved scope",
  "integrationBoundary": "Domain, persistence, callers and failure/recovery paths",
  "newEngineering": "Missing NEW behavior; distinguish already implemented code",
  "estimatedProductionLines": 650,
  "relatedWorkDecision": "Related approved work selected or concrete reason to exclude",
  "subsections": [{
    "id": "EXISTING-APPROVED-ID",
    "acceptance": ["Full original criterion, repeat for every criterion"],
    "remainingEngineering": ["Actual missing engineering at inspected baseline"]
  }]
}
```

**Compare before publication and completion.** Preserve the original block; record
deviations beside it rather than rewriting it to match a small delivery. A temporary
sanitized delivery JSON has `subsections` rows with the same `id`, `criteria`
(each with exact `criterion` and concrete `evidence`) and `remainingEngineering`
(empty only when complete); plus actual `productionAdded`, `productionRemoved`,
`newEngineering`, `planComparison`, `relatedWorkDecision` and `decision`.
Run `npm run session:bundle -- --card docs/EXISTING-CARD.md --planned-at FULL_SHA
--report /tmp/bundle-delivery.json`. Retain the comparison in the existing PR/card
handoff; the temporary JSON is accounting, not another roadmap or private evidence.

Use `decision: "CONTINUE"` when only a small remainder is done or planned engineering
remains. Keep it as contribution toward this same bundle and continue related
approved work; a merged small PR is not a successful session finish. Do not recount
old work. For a complete substantial delivery use `SUBSTANTIAL`. A delivery with
fewer than two subsections or below 400 changed production lines instead requires
`SUBSTANTIAL_EXCEPTION` and `exceptionEvidence`: concrete NEW workload/integration
proof and why grouping related remaining work is unsuitable. Merely finishing a
card, reusing extensive old implementation or passing many tests is insufficient.
The checker flags these exceptions for substantive review; it cannot judge the
truth or substance of prose. Its `SCOPE_ACCOUNTING_CHECKED` result is never a
bundle certificate, CI/review pass, merge permission or real acceptance proof.
If a planned outcome turns out small, retain that plan and delivery as a
contribution. Plan related additional scope in its existing selected execution
card before coding; compare each preserved plan and review the combined NEW
workload before counting this bundle once. A contribution report may correctly
remain CONTINUE_BUNDLE; it is not a separate bundle or a failed implementation. Never shrink away unfinished scope, pad code or
invent approval.

Use focused checks while assembling; run all required publication/CI/review gates
on the substantial coherent tree. Split only for a concrete migration, dependency,
safety or reviewability reason, keep all guards distinct and count the bundle once.
If insufficient related approved engineering remains, show the inspected scope and
ask the smallest necessary owner decision while continuing independent eligible
work. Actual execution limits require an explicitly INCOMPLETE recoverable handoff.
Maintenance/review-only requests (including this owner-requested workflow repair)
claim zero product bundles and need no fabricated implementation bundle plan.
For already-started work, preserve it, record the current baseline and plan remaining
work now; never fabricate a pre-code plan for work already performed.

**Acceptance and blockers remain additional obligations.** Test each eligible check
against actual deployed ancestry, even when main is ahead. An unavailable TEST
principal, original fixture ownership, runner or optional provider consent is a
specific dependency to investigate, not a blanket acceptance deferral. Record the
exact check, current evidence, attempted remedy, needed action/authority, responsible
party and re-entry trigger. “Coordinate with the runner” alone is not a remedy:
actually coordinate when authorized, or ask the owner the exact actionable question
in the active chat. Do not copy credentials, take over another runner's rotating
grant, recreate uncertain fixtures or bypass approval to clear that dependency.
Continue independent engineering while it remains blocked. Final reporting includes
checks actually performed and actionable remaining prerequisites, not merely
“deployment-dependent checks queued.” Use existing queue/handoff records.

## Count complete predefined batch subsections

The PR workload target is 2–5 whole predefined batch subsections on average,
using the existing roadmap/design IDs such as H-3 or B-5. Technical slices,
functions, tools, UI hookups, guards and packet checklist tasks are internal
implementation steps, not countable batch subsections. List the subsection IDs
and full scope before coding. Partial subsections count zero; count each once
when eligible engineering and required pre-merge proof are complete, with
external acceptance tracked separately. Use focused checks while building,
then the full required gates on the substantial assembled PR. See the governing
instructions' **PR workload is measured in predefined batch subsections** rule.

## 0. Reconcile and recover

Read the governing instructions and the current permanent handoff, not historical
status entries as new work. Verify actual main, live, the READY production revision,
open/unfinished PRs, exact-head CI and unresolved reviews. Preserve concurrent work.
Recover your interrupted/red PR first; inspect all failures and batch their remedies.

## 1. Catch up released work before new implementation

Fetch main/live refs and independently verify the actual serving production origin,
source SHA and READY state. Workflow success, branch equality or a service self-report
alone is insufficient. Run `npm run session:status -- --deployed FULL_SHA --state READY`
with those observations, or use the same ledger and exact GitHub compare/deployment
evidence manually when no shell is available. The command is read-only: it does not
execute acceptance, release software or authorize provider operations.

Evaluate EACH outstanding check against its required revision in deployed ancestry.
Main/live equality is never a global acceptance prerequisite. Perform every currently
eligible authorized check before selecting new implementation; recheck BLOCKED rows
against current decisions and attempt authorized remedies. Defer only the affected
check with its exact missing prerequisite, investigated remedy and next action.
Missing history means fetch/compare that revision; it does not mean “not released.”
Preserve valid evidence until relevant changes invalidate it. Reading the queue or
observing a release is not acceptance execution. Preserve fixture and cleanup gates.

Reconcile all outstanding queue rows, including rows hidden by an output limit, in
the existing ledger/handoff. Before new implementation and final reporting, validate
that accounting with `npm run session:status -- --deployed FULL_SHA --state READY
--acceptance-review /tmp/acceptance-review.json`. This temporary sanitized extract
is not a second ledger and must not contain secrets, provider bodies or private IDs.
It contains the printed `snapshot` digest, `deployed`, `deploymentState`, and `tasks`; every outstanding task needs
`id`, `requiredRevision`, current planner `disposition`, `outcome` and `evidence`.
Use `PERFORMED` with `result: PASS|FAIL` (and `nextAction` for FAIL), or `DEFERRED`
with `prerequisite`, `remedy` and `nextAction`. Existing recorded passes need no
retyping; optional `REUSED` entries reference their evidence. The checker requires a verified READY deployed revision and rejects
omissions or changes to any queue field via the snapshot digest; it cannot attest evidence truth or grant permission.
Without a shell, put the same item-by-item accounting in the permanent handoff.
Record actual results in the existing ledger; rerun the extract after ledger changes.
An inaccessible deployment/evidence source requires investigation and a specific
checkpoint, not fake observations or a project-wide stop.

Recheck at observed releases/configuration changes, after meaningful merges, and
before final handoff. A scheduled, delayed, recovery or separately authorized manual
release uses the same per-check procedure. Follow the checked release policy; never
initiate a release just to finish a development bundle.

## 1a. Choose a substantial outcome

Read the authoritative work index/roadmap and the highest-priority eligible card.
State its observable result and finite acceptance before editing. Read only its named
code seams, design sections and fixtures; reuse existing helpers and task/packet tools.
Group compatible adjacent roadmap slices into a complete usable workflow,
including callers, real integration and tests. Plan implementation PRs around a **rolling average of 400–800 meaningful
production-code additions** (exclude tests/docs/generated/format-only work)
and **2–5 fully complete predefined batch subsections** per PR on average.
Use `npm run pr:progress` to measure actual diffs and recent merges; do not
pad changes or break a safe coherent boundary solely to meet numeric targets.
Explicitly list approved slice IDs and their full acceptance criteria before
writing code; never count a function, tool or partial seam as a completed slice. Larger
cohesive PRs require extra integration/risk/verification coverage. Preserve actual
migration ordering, risk isolation and every business/security/financial decision gate.
Do not revisit passing hardening without a demonstrated defect or approved requirement.

## 2. Finish the roadmap unit in order before selecting another

Read AGENTS.md's *Roadmap order, complete batches and immediate owner
escalation* rule. Start from actual main and the active work-index packet.
Build and verify the **entire current outcome**, not an arbitrary next
helper. Keep its dependencies, customer path and integration together.
Use one finite checklist in that existing packet: remaining domain/provider
behavior, owner/customer callers, denial/replay/failure paths, fixtures and
integration proof. A passing helper or PR count is not completion of the outcome.
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

Follow §2 above and AGENTS.md's authoritative completion rule. Independent
parallel work requires explicit roadmap eligibility; preserve every activation gate.

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
checks only when that source is in deployed ancestry. If a permitted squash/rebase
removed the pin, reconcile it to the independently verified merged implementation
commit before handoff; never mark it passed or repin to unrelated code.
Execute cleared checks promptly, record sanitized read/write/denial/readback/cleanup proof, and retain
failed/uncertain fixture recovery tasks. New changes, rollback, authorization or environment
changes reopen affected proof. NEVER copy credentials/private fixture IDs into the queue.

## 4a. PR outcome scorecard — checked claims, independently reviewed proof

Each PR updates `docs/pr-cards/current-pr-scorecard.json`. For an implementation
PR, use the predefined batch subsections in the authoritative roadmap/design;
packet `slices` are internal checklist tasks unless they already represent a whole
such subsection. Count full batch subsections, not the packet's task count; each
claimed completed ID must have concrete acceptance evidence and zero remaining
engineering for that slice. Maintain remaining engineering and external-release/
provider/owner acceptance separately. A maintenance/tooling PR uses
`kind: "maintenance"`, declares no completed product slices, and is excluded
from the implementation-code rolling average. Do not game scope by relabelling
product work maintenance. Run `npm run pr:progress -- --check` and before PR
creation `npm run pr:progress -- --base origin/main`; the latter reports actual
production lines and the last five merged implementation PRs when history exists.
A shortfall in either rolling target should be explained in the PR, not fixed
with filler code or fictitious acceptance. Rolling slice averages use only
scorecards changed by their own implementation PRs; older undocumented
completions are `unknown`, not zero and not invented. CI requires an updated scorecard for each PR and rejects production-code changes
misclassified as maintenance. It validates shape and approved IDs, not test
truth; exact-head CI and human/code review still govern.

## 5. Checkpoint and finish

Before reporting session completion, reconcile the acceptance queue again against
actual deployment and finish its accounting above. Report performed checks/results,
reused proof and each deferred check's exact prerequisite/remedy/next action, alongside
bundle outcomes, subsection IDs, merged PRs, checks/reviews and cleanup. Update existing
status/cards/index and the permanent merged-PR handoff. Reaching N bundles or pushing
a checkpoint does not complete the session while eligible obligations remain.
An actual execution limit requires an explicit incomplete, recoverable handoff.


Keep a short progress note on interrupted branches: head, done/proof, one next action,
CI/review state, successor and exact blocker. Diagnose and attempt authorized remedies
before deferring; isolate the operation and continue approved independent work. Limited
release frequency is planned queued acceptance, never a project-wide stop.

When the current owner specifies N bundles, continue toward that target under
the evidence-backed blocker/limit rule above. Without a specified target, use the
available recoverable context for complete approved outcomes. Target rolling averages of
**400–800 production-code additions and 2–5 complete predefined batch subsections per
implementation PR**; review risk, end-to-end behavior and context safety can
justify a documented exception. Never substitute line counts for functionality
or fabricate slice subdivisions to inflate progress. Session PR count is set only by the current owner prompt.
Do not count a passing helper as a completed outcome. After each verified
merge, checkpoint the exact head/CI/reviews, completed slices, implementation
and deployed/real-acceptance state, and one next action. Continue the planned bundle after checkpoints. A demonstrated execution limit
requires an explicitly incomplete handoff with exact recovery action; a clean
checkpoint or speculative context concern does not establish bundle completion.
Persist unfinished work on its existing approved card, not only in chat.
Report completed roadmap slices and acceptance deltas, first-pass CI failures
and correction cycles, not PR count as a productivity metric.
Historical maintenance notes do not redefine the current owner request. Follow its actual scope/target; preserve safety and report genuine execution limits with concrete evidence.
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
## Anti-stall recovery: persistent progress, not a restart (2026-10-15)

The approved W-22FIN V2 implementation exposed a concrete failure pattern: 20
working-tree changes spanning more than ten financial consumers accumulated
without a recoverable Git commit or one accurate boundary list. Large command
payloads were rejected, and the initial TypeScript process exhausted the
default Node heap (a later 3072 MB heap typecheck succeeded). The agent then
responded to interruptions by repeating diagnosis instead of making the
next bounded implementation/checkpoint step. This was **execution workflow
failure**, not evidence that the roadmap, credentials or provider approval
was blocked.

**Required corrective loop for large integration bundles:**

1. After reconciling main, live, PRs, acceptance and the approved whole
   subsection, run `npm run work -- checkpoint` in the existing implementation
   worktree. This *read-only* command lists changed/untracked paths, head/ref
   divergence and unresolved conflicts. It neither certifies nor commits work.
2. Divide the **work**, not the bundle count: keep a written list of real
   integration consumers (financial sources, frozen proof, signing, settlement,
   cancellation, first invoice, owner/customer DTO, migration, tests). After
   each coherent end-to-end edit, run its focused tests and inspect actual
   exit code and logs. Do not open a separate PR for helper/docs/repair work.
3. When a tool call or check fails, identify its precise cause. For rejected
   oversized shell patches use short, targeted edits. For TypeScript OOM use
   isolated `NODE_OPTIONS=--max-old-space-size=3072 npm run typecheck` on
   a 4 GB sandbox, or authorized CI resources. Do not suppress, truncate, or
   misreport failures; a piped `head`/`tail` needs `set -o pipefail`.
4. Before the session becomes long, commit a coherent, recoverable
   **work-in-progress checkpoint** to the *same implementation branch* once
   locally feasible. WIP commits do not satisfy review, merge, engineering
   completion or release gates. Push to that branch only under existing
   repository PR/push policy and never bypass exact-head CI. Record failed
   checks and next consumer in the permanent PR handoff before interruption.
5. After an interruption, FIRST recover the existing worktree, run
   `npm run work -- checkpoint`, resume the next recorded consumer, and
   perform the previously missed eligible acceptance. Do not start a fresh
   worktree/PR, redo all passing checks, restate a diagnosis without action,
   or silently discard uncommitted files.
6. Only claim a **bundle completed** after its entire approved engineering
   outcome is implemented, required tests/reviews pass at the merged head,
   and the PR is merged. Independently verify latest READY/live deployed
   ancestry per acceptance requirement; main ahead of live never disqualifies
   checks present in deployed source. Preserve all live payment, approval,
   customer consent, refund and spending restrictions.

This recovery procedure is operational only: it cannot lower any existing
check, professional/provider gate, legal approval, or release policy.
