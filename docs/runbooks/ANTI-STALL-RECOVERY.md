# Anti-stall recovery: bounded work and verified resumption

Read after `AGENTS.md` anti-stall rules. This runbook applies to local checkouts,
Vercel Sandboxes, GitHub REST, CI and 5-PR sessions. Keep each PR's financial,
security, owner-approval and exact-head CI gates intact. **Do not bypass gates
for speed.**

## Diagnosed October 11, 2026 — W-22C

1. `npm run test:db -- <one spec>` invokes the *preflight planner*, which can
   expand the affected source graph into `vitest related` (1131 tests in the
   observed run). The command did not hang: it executed a much larger plan.
2. `git push` runs the installed pre-push quick gate (typecheck/lint/etc.).
   A lengthy push with no new GitHub branch does not mean auth failed.
3. An oversized Vercel terminal tool call with a long here-document can be
   rejected before execution; large outputs can also be truncated.
4. PostgreSQL enum migrations passed ordinary apply but failed disaster restore
   because `scripts/restore-backup.ts` wraps each migration in `BEGIN`/`COMMIT`.
   A new enum value cannot be used in the same transaction; split enum and
   dependent seed into two ordered migrations and verify restore.
5. Codex automated review reported its usage quota exhausted. Check actual
   review comments/threads, perform and record the repository-approved manual
   review/waiver, never wait indefinitely or claim an automated review passed.

## Diagnosed October 12, 2026 — PR handoff and expiring sandbox

W-22C6A commit `6c0065a` was pushed to the remote branch, but the agent
continued into W-22C6B without creating its PR. The completed push and clean
worktree were mistaken for a completed publication step. That is a *handoff
state gap*, not a Git authentication or application failure.

After each PR, record and verify **all six distinct states**:

1. **Committed:** `git rev-parse HEAD`, `git status --short`, exact tests and
   base SHA recorded in the card's progress checkpoint.
2. **Pushing:** capture the Vercel session/command ID. Pre-push hooks can run
   `typecheck`/`eslint` at high CPU for minutes. Query that same command
   and inspect its exit code and logs; do not start a duplicate push or bypass
   hooks merely because the branch is not yet visible.
3. **Remote confirmed:** compare `git ls-remote origin
   refs/heads/<branch>` to local HEAD. If a process/session disappeared,
   check the remote SHA **before** retrying. A matching remote commit means
   the push is done; go straight to PR lookup.
4. **PR confirmed:** search GitHub for an open or closed PR using the exact
   branch. If none exists and the remote SHA matches, immediately create
   the PR via GitHub MCP/REST. Record PR number. Never treat branch-pushed
   as PR-open or begin a successor without a recorded owner for this step.
5. **Exact-head gates:** verify required CI jobs on the PR's *current* head,
   unresolved review threads and comments; use the allowed manual-review
   waiver only when automated review is genuinely unavailable. Queued and
   running checks are not passes.
6. **Merge receipt:** require `merged=true` and the actual merge/main SHA,
   then review post-merge checks and refresh the successor once. Only a
   verified merge increments the five-PR session count.

**Sandbox expiry** is different from an individual command timeout. A
`410 sandbox_stopped` means the old session ID is unusable. Resume the named
persistent sandbox, capture its new session ID, then inspect the worktree,
git status, remote branches and PRs before reissuing anything. Uncommitted
worktrees must not be hard-reset. Prefer short bounded, observable calls.
Before a long pre-push/CI operation, verify the remaining sandbox lifetime
and capture the current command/next action in the progress checkpoint.

**Decision table:** a running process with CPU activity is slow, not stalled;
a terminated command with nonzero exit needs first-error triage; a remote
branch with no PR needs PR creation; an open PR with green CI needs review/
merge; a stopped sandbox needs session recovery. Never repeat the same
operation without checking which of these states actually applies.

## Exact recovery loop

- **Checkpoint before a slow command:** write the current card/step, branch,
  last commit, files touched, tests required, active PR and next command in a
  short progress note (the card's `.progress.md` while incomplete). Inspect
  `git status --short`; do not discard uncommitted work or mutate another
  worktree. After a sandbox resume, verify the **new** session ID and status.
- **Select, then run:** `npm run preflight -- --plan --unit <spec> --db <spec>`
  shows the selected scope. For an isolated Postgres fixture, invoke
  `timeout 600 bash scripts/local-postgres-test.sh --checks --db <spec>`
  to avoid accidentally sweeping every related source test. The supported shorter form is npm run test:db:probe -- tests/exact.test.ts. That command is diagnostic ONLY; full preflight and exact-head CI remain mandatory. The focused test
  is not proof that CI has passed; full exact-head CI is still mandatory.
- **Bound and observe:** use `timeout 600` on slow operations, `set -o
  pipefail`, and a file-backed log (`> /tmp/<card>-check.log 2>&1`) with a
  command identifier. If supported, start a tool command with `wait:false`,
  then query command status and inspect `tail -30` in **separate calls**.
  Do not leave an untracked background job, busy-wait, unbounded poll loop,
  or start a duplicate test while the original process remains running.
- **Reduce tool payloads:** write or edit one coherent file at a time; keep
  each terminal request small. If a safety/tool wrapper rejects one, inspect
  whether it ran (`git status`, file size, process list), then split it into
  smaller commands or use existing GitHub REST tools. Never repeat an identical
  rejected payload three times.
- **No false progress:** don't count a created branch, passing local tests,
  open PR or CI-in-progress as a merged PR. Check exact head SHA, all required
  checks, review threads, comments and preview evidence. Merge once, verify
  `main`, then refresh the successor exactly once at the PR boundary.
- **Two strikes:** after two identical failures, inspect the **first failing
  assertion** and change strategy. For an enum/restore failure, use the
  two-migration rule above; for authorization/push failures, follow
  `docs/runbooks/SANDBOX-PUBLISH.md` or documented GitHub REST fallback. Do
  not silently weaken tests, turn off pre-push checks or live approval gates.
- **Stall report:** if blocked despite alternatives, report checked SHAs,
  completed merges, the precise command/error, unchanged local files/branch,
  and one safe next action. Include these in the next continuation prompt;
  never assert all five merges if only some completed.

The progress log is for resumability, not permission to publish partial work.

## Sandbox stale remote tracking (October 11, 2026)

When a checkout lacks remote.origin.fetch, git fetch origin main may update only FETCH_HEAD, leaving origin/main stale. Compare git ls-remote origin refs/heads/main with git rev-parse origin/main; if mismatched, run git fetch origin +refs/heads/main:refs/remotes/origin/main. Preserve any preexisting dirty checkout and use a separate clean worktree.

## October 12 — Next.js/Turbopack worktree dependency symlink

A sandbox worktree at `/vercel/appliance-desk-w22c6b` passed unit,
TypeScript and disposable DB checks but `npm run build` failed with
`Symlink [project]/node_modules is invalid, it points out of the filesystem
root`. Its `node_modules` was a symlink to another worktree, which
Turbopack explicitly refused; this is **not** a product test failure.

Inspect `ls -ld node_modules` first. If it is exactly the checkout-created
symlink to the known dependency installation, preserve the target and
replace only that symlink with a worktree-local dependency tree (a hardlink
clone with `cp -al` is cheap on one filesystem; otherwise use the repository's
normal install process). Never remove a real directory containing user work.
Do not update/install packages into a shared hardlink clone; a real isolated
`npm ci` is required before such mutations. Rerun the same browser/build
check and then retain the exact-head CI gate.

## October 12 — bounded 4-GB Sandbox browser-build resource gate

After replacing the external and nested `node_modules` symlinks, the
2-vCPU / 4-GB sandbox's local `npm run build` was killed with exit code
137 during the disposable-browser acceptance run. This differs from the
Turbopack symlink failure: it is a resource limit, not a new assertion.
Do not retry the same heavy build repeatedly or silently upgrade paid
sandbox resources. Record the exact local limitation, preserve successful
focused/unit/disposable-Postgres checks and require the unchanged full
GitHub exact-head CI/browser checks before merge. A browser acceptance claim
is permissible only after the corresponding CI/browser job passes.


## October 12 — external PostgreSQL image pull quota, and stalled CI diagnosis

During PR #409 (head d14ef91) the Performance Baselines capacity job
failed before checkout/test/setup because the external container registry
responded `toomanyrequests: Data limit exceeded` for
`public.ecr.aws/docker/library/postgres:17` on all three runner pull
attempts. The separately required CI workflow completed all eleven jobs
successfully on the same PR head, including browser and unit shards.
This is an *external registry capacity failure*, not a failed application
performance assertion; do not change product code or claim the performance
baseline passed.

Recovery sequence for a failure discovered during publication:

1. Read the failing *job* log, not just workflow summary. Identify the
   first error and whether repository steps were reached; record the job ID,
   head SHA, exact error, failed workflow name, and which CI checks passed.
2. Classify infrastructure-only errors (registry HTTP 429/data limit,
   unavailable GitHub runner, transient DNS) separately from failing tests.
   Preserve all required checks. Never waive a performance/security gate
   simply because its infrastructure failed.
3. Retry the failed workflow jobs **once**, only if the existing GitHub Actions
   API permits it. A 403 `This workflow run cannot be retried` is a terminal
   response for that attempt: do not poll/retry the identical operation.
4. If retry is refused, inspect the repository's existing workflow-dispatch
   or documented CI fallback and the actual branch protections. Prefer
   preserving an immutable existing head to a dummy commit just to force
   another run; avoid switching registries speculatively or changing paid
   runner resources. If the performance check is required, keep the PR open
   until a genuinely passing required result exists.
5. After a failed *optional* diagnostic job, if the repository's merge gates
   permit proceeding, explicitly record the diagnostic as failed/external,
   not passed. Complete code review, exact-head required CI and approvals
   before merge. Do not count a PR until GitHub confirms `merged=true`.

While a successor worktree is being prepared, track the predecessor PR's
actual state and checks at every tool boundary. A running workflow should
not cause silence: report its current state, then perform independent
authorized successor work without claiming merge.

## October 12 — document renderer related-test fan-out

W-22C6C changes to document rendering made `preflight --related` select 149 files and 953 tests on disposable Postgres, even though the explicit requested specs were small. The first pass reported three legacy lifecycle fixture failures because mocks omitted the new setupFeeCents/setupTaxCents/downPaymentCents evidence. Preserve strict production validation; correct incomplete mocks with explicit reconciled zero cents, run failing specs in `test:db:probe` first, then rerun required preflight and exact-head CI. A plan is a scope estimate, not a guarantee of a small run. Avoid repeating a full 953-test run until targeted failure fixtures are repaired.

## October 12 — interruption after green CI while successor has uncommitted work

**Observed recurrence:** PR #412 (`7fd5e54`) had passed exact-head `ci` but remained
OPEN, while the successor W-22D3 worktree held edits and untracked tests. The
previous Vercel Sandbox session expired; querying its old command/log API
returned `410 sandbox_stopped`. The agent did not return to the PR's
**review → merge → receipt** handoff, despite checks being green. This is a
lost *handoff owner*, not a repository test failure, credential failure or
missing code. The UI test from the next worktree remained in the persistent
snapshot and was recoverable. Do not speculate that a command stalled until
its actual state is inspected.

**Practical prevention (required in 5-PR sessions):**

1. At the beginning of each tool burst, look at the **oldest open PR** and
   current worktree before doing new edits. Log one short line in the active
   card's `.progress.md`: `A: PR #number/head/ci/review/merge next action | B:
   worktree/HEAD/dirty files/next test | verified main SHA | merge count`.
   If the PR is green, immediately review and merge; do not leave it open
   while continuing with successor refinements. Never treat 'CI green' as
   'merged'. Delete the progress note in the final commit when both lanes
   have a verifiable owner/receipt.
2. **Tool budget per handoff:** one batched GitHub call for PR head, the `ci`
   check and review threads/comments; one corresponding outcome: fix,
   record manual-review waiver where Codex quota is exhausted, or merge.
   Queued/running CI is not permission to merge; proceed with the already
   authorized successor work *only while it is actually running*. Never
   send repeated identical status queries without new actionable work.
3. **When a user interrupts or a sandbox expires**, never start a new
   worktree or discard a modified one. Check live `main`, open PRs and CI
   first. Resume the same named persistent sandbox from its last snapshot,
   capture the **new session ID**, inspect `git worktree list`, `git status
   -sb` and untracked files for the predecessor and successor. A stopped
   command ID has no current progress; retrieve saved logs from the
   restored worktree (or rerun a bounded *idempotent* test), not the dead
   session. If completed PR head remains green, resolve review and merge
   **before** continuing the preserved successor.
4. **The exact checkpoint is written immediately, not remembered:** as soon
   as the predecessor PR exists, put PR number, full head, CI state and
   pending review/merge in the successor progress note, before substantial
   successor edits. Update it after the predecessor merges, including the
   merge SHA and whether `origin/main` is synchronized. The next chat must
   use those receipts, not the PR number expected from a prompt.
5. **End-of-burst reporting:** report `merged N/5`, the actual open PRs,
   exact head/check state, dirty successor worktree, and what operation
   currently owns the next action. An idle tool gap is **not** an active
   process; never claim a background test/review still runs without a
   live command or GitHub queued/running status.

**Observed recovery:** resumed `appliance-desk-s1c-oct8` from its snapshot,
confirmed W-22D3's uncommitted action/UI tests intact, confirmed PR #412
12/12 checks successful on `7fd5e54`, reviewed/waived quota-exhausted Codex,
merged #412 at `3b2b11568d031572dfd9a000b0b0ba9274c4d676`, then fast-forwarded
the successor to that exact `main` without resetting its changes. Preserve this
sequence for the next interruption. No new cost tier, secret or provider switch.

### October 12 — reused dependency tree becomes an invalid browser-build fixture

While validating W-22D3, the first sandbox browser build failed because a
worktree `node_modules` symlink targeted `/vercel/appliance-desk/node_modules`
outside Turbopack's project root. Replacing that **known symlink only** with
a local `cp -al` clone allowed resolution to progress, but the **second**
browser build failed before any browser test, reporting missing
`@vercel/turbopack/postcss`, `@better-auth/core/api`, `zod` and hundreds of
module resolution errors. The hardlinked copy included a nested
`node_modules/node_modules` symlink to the original checkout. This is a
sandbox dependency-tree problem, not evidence the changed UI failed.

**Second-strike response:** do **not** retry this build repeatedly, overwrite
another worktree's dependencies, run blind package upgrades, disable browser
checks or purchase larger sandbox resources. Preserve focused UI/action
results and TypeScript/lint evidence, record both exact failing commands,
then publish only with the repository's required unmodified **exact-head
GitHub `ci` and browser jobs** as the merge gate. A clean isolated `npm ci`
is an optional *future* diagnostic only if within time/cost guardrails, not
permission to bypass CI. Clearly say local browser acceptance was unavailable
when reporting, even if GitHub CI later passes.

### October 12 — second sandbox expiry between accepted PR and DB probe

The `appliance-desk-s1c-oct8` session `sbx_CDAVfTwGnE2wMdIdMTQI0CTwtwM7`
expired at its configured 30-minute limit just before W-22D4's next
command was accepted. The API returned `410 sandbox_stopped`; **no DB probe
was started and no test failed**. Resuming that *same* persistent sandbox
preserved the complete dirty W-22D4 worktree. The refreshed session was
extended within the existing sandbox's resource tier before its substantial
DB/preflight run; no paid upgrade or extra sandbox was created.

Before any 5+ minute preflight/push in a resumed sandbox, read its actual
`expiresAt` and compare remaining lifetime with the command's bounded
timeout and a practical review/publish margin. If too short, checkpoint the
PR/dirty-worktree/command first, then request an allowed extension of the
**same** session within existing cost/approval limits. If extension is not
available, run a shorter focused check and checkpoint for a clean resume;
never launch a full command that cannot finish within its lease, and do not
silently buy resources. After `410`, resume and inspect preserved worktree
and remote receipts before trying a command on the new session ID.

### October 12 — completed 7-minute preflight was not reported or triaged

W-22D4's broad affected-graph preflight **finished with exit code 1**
(446 seconds); it did not hang. The agent failed to inspect that terminal
receipt before its next user-facing reply. Its summary was `157` suites:
`151 passed`, `2 skipped`, `4 failed`; of `1,000` tests,
`997 passed`, `2 skipped`, and one assertion failed. The new FK correctly
blocked three legacy integration fixtures from deleting agreements while
`AgreementSigningPayment` still existed. Fix their teardown ordering instead
of weakening the **ON DELETE RESTRICT** production financial-audit FK. The
fourth failure asserted `shortTermLeaseElection=UNDECIDED` while the
shared BusinessSettings singleton was `COLLECT_ON_RENTALS` during a wide
parallel run. That tax migration suite passed in isolation alongside the
three repaired suites (38/38), and focused signing/backup/restore cases passed
(30/30). Treat the shared-settings interaction as a test-isolation suspicion,
**not** a tax-code fix or a green broad preflight.

**Required response:** after any command's bounded timeout or completion,
read its exit code and the bottom-of-log summary immediately, extract each
failing test or cleanup, and record them before unrelated work. Repair
precisely the failing fixture/model; rerun those cases in the repository's
isolated disposable DB, then run requested affected checks and require the
exact-head CI aggregate. Never leave a known failed local preflight
unreported, confuse expected stderr from `.rejects` tests with actual
failures, or weaken money-history constraints merely to make fixture teardown
pass. Store the actual result and remaining risk in the PR review note.

### October 12 — exact-head CI exposed a global-count race missed by local probes

PR #414's first exact-head CI run passed typecheck, browser shards and 2/3
unit shards, but unit shard 1 failed a W-22 integration assertion comparing
**global** `ProviderOperation.count()` before and after a checkout refusal.
Another concurrently running suite legitimately created an unrelated provider
operation in the same disposable test database (8 vs 7). That assertion did
not measure the target agreement's side effects. Fix every affected counter
to scope by `subjectId: agreementId` (or equivalent entity identity); verify
isolated tests, then push a **new** head and require fresh exact-head CI. Do
not rerun an unchanged flaky shard as if that fixed the test, and do not
change production provider controls to accommodate incorrect fixture counts.

### October 12 — review-safe financial visibility test recipe

PR #415 initially had mocked `AgreementSigningPayment` and `requireRole`
tests. Reviewer P1 correctly required real database/authorization acceptance.
Before publishing any future finance-visible exception/query slice, pair
quick deterministic mock tests with at least one **disposable PostgreSQL**
probe: insert real due/waived records, execute the genuine query and role
validator against controlled authenticated identities, demonstrate
OWNER/ADMIN visibility and STAFF/CUSTOMER rejection, verify amount/ordering
and zero forbidden side effects. Mock only external session issuance/Next
request interfaces when exercising the genuine role implementation, not the
role checker or Prisma. This up-front fixture prevents another review/
re-push/full-CI round trip. Preserve per-test cleanup of any restrictive FK
children before deleting parent test agreements.

### October 12 — checked capability entrypoint and stage/commit cache repair

Use `npm run work -- start` before another broad reading pass; `read <number>`
prints at most 102 lines around one integration anchor. `route <unit>` provides
later discovery anchors only. `doctor` diagnoses missing hooks, mismatched lock
or a shared dependency tree without probing credentials/providers. Write/refresh
one current card/packet from actual approved contracts, not all future cards.

The former cache fingerprint mixed index/diff representations: the same checked
bytes got three keys before staging/after staging/after commit. Actual file,
path/mode/symlink identity now yields one key. Secret scanning includes new
non-ignored files before staging, matching cache coverage; the security gate is
not skipped. Finish docs before final checks so real edits do not invalidate them.
Use `work -- metrics` to inspect bounded local passed/failed/cached elapsed data;
`--fresh` forces checks and no cached local result replaces exact-head CI.

`work -- plan` reports proposed test files and affected-source fan-out. A missing
proposed regression is implementation work: write it, do not retry verify or
claim the plan passed. `probe` remains single-spec diagnostic; complete normal
preflight after focused repairs. A stale anchor means mechanical drift to repair,
not project-wide blockage. No old 800-line, preview or manual batch-release stop.

A clean worktree install in this session failed because `prisma generate` requires
DIRECT_URL even without a connection. `npm run work -- install [--offline]` now
runs reviewed generation-only postinstall with synthetic localhost DATABASE_URL/
DIRECT_URL, strips inherited deployment/provider identity, includes dev tools and
refuses a shared node_modules symlink. It never runs migrate/seed, prints credentials
or claims provider readiness. Offline install requires the existing npm cache;
repair a real missing-package error instead of adding production connection strings.
