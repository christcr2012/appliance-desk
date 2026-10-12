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
