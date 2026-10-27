# AGENT-QUICKSTART — commands and known CI failures

Rules: [/AGENTS.md](../AGENTS.md). Procedure: [SESSION-START.md](SESSION-START.md). The older 88-line version (with the
scorecard/bundle-plan steps) is archived in [archive/rules-reset-2026-10-23/](archive/rules-reset-2026-10-23/).

## Commands

```bash
npm run setup                 # once per checkout/worktree: pre-push gate, HTTP/1.1, merge-based syncing
npm run work -- start         # active card and bounded integration references
npm run check:quick           # same gate the pre-push hook runs (secrets, migrations, routes, typecheck, lint)
npx vitest run tests/x.test.ts                         # focused unit test
npm run test:db -- tests/y-integration.test.ts         # disposable Postgres + migrations, one command
npm run test:browser -- e2e/z.spec.ts                  # builds if needed; never bare playwright
npm run bundle:preflight      # optional: runs the paperwork checks CI runs and explains failures in plain English
```

Never run watch modes, `npm run dev` or `--no-verify`. Wrap slow commands in `timeout 600`. **Before a push**, run the focused regression for changed behavior, then `npm run check:quick`; a desk menu/job-role mapping edit also runs the fast job-role permission test. Do not run the full local suite after every edit.

## Hosted provider acceptance

Use [TESTING-ENVIRONMENT.md](TESTING-ENVIRONMENT.md): the dedicated testing app, existing synthetic preview DB,
independent role/storage/auth and official Stripe Test mode. `npm run db:seed:testing` is guarded, additive and
never substitutes for unit/integration suites on throwaway Postgres. Do not point the public app at the testing
DB, reset from the parent, copy production identities, or mark business tax settings approved to unblock a test.

## The loop

Branch `ai/<tool>/<topic>` from `main` → build with tests → `npm run check:quick` → **one push** → open PR (plain English
body) → **turn on auto-merge (squash)** and keep working → answer every Codex finding with a reply (if Codex is
unavailable, post one "self-reviewed" comment after your last push) → GitHub merges by itself when `ci` and
`review-gate` are green; main moving does not force a re-sync → short STATUS entry → report to Chris.

## When CI is red

Read **all** failed CI jobs before editing. The connected Robinson GitHub MCP provides `github_actions_get_run`, `github_actions_get_job_log` and `github_workflow_ci_failure_summary` for job logs and complete failure summaries; REST check-run annotations remain a fallback. Distinguish a failed assertion, missing test fake or secret finding from a passing command that merely exceeds the **informational** 180-second phase target. Slow passing commands remain green; do not rerun for timing alone. Fix **all real failures**, reproduce locally, push once. A green check on an older SHA is not proof for your latest push.

| What CI says | Real cause | Fix |
|---|---|---|
| check-docs-updated | `src/` or `prisma/` changed without a STATUS update (or `docs/DATABASE.md` for schema changes) | add the short STATUS entry / DATABASE note, or put `Docs-update: not needed — <reason>` in the PR body |
| work-session check | stale integration anchor in the packet | `npm run work -- check`, fix the anchor text |
| check-owner-decisions | changed `activeExecution` without a map entry | add `activeExecutionMustRemain` in `docs/owner-decisions/2026-10-13-implementation-map.json` and the ID to `allowedOrdered` in the script |
| e2e-shard | new spec not in `e2e/shards.json`, or a skipped test | register the spec once; skips need `INTENTIONALLY_SKIPPED` in `scripts/e2e-shard.mjs` with a reason |
| gitleaks / secret scan | key-shaped string in code, docs or tests — **PR/push Gitleaks scans only its new commits** (nightly scans main history); the project-specific scanner still checks every current file, so unrelated branch history no longer breaks another PR | first decide: **real credential?** → stop, remove it, tell Chris so it is rotated (AGENTS.md section 1); never just suppress it. **Verified fake** (made-up test value) → replace it with an id built at runtime; a removal commit doesn't clear history, so add that commit's fingerprint to `.gitleaksignore` with a dated reason and say why in the PR body (no force-push) |
| typecheck: unused `@ts-expect-error` | importing a `.mjs` that already has types | delete the comment |
| scenario test flaky / wrong counts | `tests/scenarios/**` share one database | purge queues with `purgeScenarioQueues`, count only rows you caused, never depend on another file's leftovers |
| a11y/axe failure on a touched page | missing label, focus ring or contrast; `sr-only` text inside an `overflow-x:auto` box needs a `relative` wrapper | fix the markup; never skip the test |
| slow unit/browser shard notice (tests pass) | that group exceeded the 180-second **performance target**, not a test failure | leave CI green and retain the timing notice; compare the **same group over its last five comparable full runs**. Rebalance only if **3 of 5** exceed the target or a reproducible structural regression explains the slowdown. Never skip tests to speed it up |
| owner-guide-coverage | a new desk screen not named in `docs/OWNER-GUIDE.md` | add it |
| a menu test counts links | you added a desk menu link | update the expected count and assert the new link |
| typed value doubled in a form test (e.g. "1012") | typing before the client form loaded its saved value | wait for the saved value to show, then fill |
| "capacity baselines" timing | noisy shared runner | rerun that job once; it is not a gate on its own, but a repeat means look at the change |

## Local tests and GitHub publishing without repeat work

For money, permissions, migrations and concurrency, run `npm run test:db -- tests/<file>-integration.test.ts` or diagnostic `npm run work -- probe tests/<file>.test.ts`: the launcher starts a **new localhost-only, throwaway Postgres**, migrates and seeds it; never point tests at production or testing Neon. The launcher needs a **non-root** user and local PostgreSQL server binaries. Run only **one test command at a time** against a shared database. Use `npm run preflight -- --plan --db tests/<file>.test.ts` to inspect selectors without executing (not passing evidence). If the sandbox cannot run a non-root Postgres, run pure unit tests locally and let the complete GitHub CI provide disposable-DB and browser evidence. Do not claim local tests passed when they could not run.

When publishing via REST/snapshot rather than an actual Git push, first branch from the current `main` and commit using real Git ancestry. **Copying a merged-looking tree onto an old branch does not merge its history**: GitHub may still report conflicts and force a PR rebuild. If main advances, use a real merge/rebase commit, not a tree-only copy or force-push. Confirm the remote branch SHA, run `npm run check:quick` before publishing if the tool bypasses the pre-push hook, and use the repo's `docs/runbooks/SANDBOX-PUBLISH.md` for supported transfers. If local checks are blocked, say exactly which and rely on required exact-head CI.

## Sandbox notes (agent sessions, learned 2026-10-25)
- `prisma generate` downloads are blocked: set `PRISMA_SCHEMA_ENGINE_BINARY` to any placeholder file and placeholder
  `DATABASE_URL`/`DIRECT_URL` values, then generate. Never commit generated files.
- Full typecheck may run out of memory: `NODE_OPTIONS=--max-old-space-size=5120`.
- A local Postgres may refuse to run as root; database tests then run only in CI (that is fine).
- Production build can't fetch Google Fonts here, so browser specs run only in CI.

Missing owner-only proof is never a CI failure: it is a row in [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md).
