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
