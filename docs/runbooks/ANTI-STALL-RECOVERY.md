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
