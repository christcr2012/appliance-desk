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

Never run watch modes, `npm run dev` or `--no-verify`. Wrap slow commands in `timeout 600`.

## Hosted provider acceptance

Use [TESTING-ENVIRONMENT.md](TESTING-ENVIRONMENT.md): the dedicated testing app, existing synthetic preview DB,
independent role/storage/auth and official Stripe Test mode. `npm run db:seed:testing` is guarded, additive and
never substitutes for unit/integration suites on throwaway Postgres. Do not point the public app at the testing
DB, reset from the parent, copy production identities, or mark business tax settings approved to unblock a test.

## The loop

Branch `ai/<tool>/<topic>` from `main` → build with tests → `npm run check:quick` → **one push** → open PR (plain English
body; "automated review unavailable — waived; self-reviewed" if none appears) → read the `ci` result at the exact head →
read every review comment → merge with the expected-head SHA → short STATUS entry → report to Chris.

## When CI is red

Read the annotations of the failed check (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`; raw logs are not
downloadable). Fix **all** failures, reproduce locally, push once.

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
| browser shard "phase budget" (tests pass, job fails at ~3 min) | that group exceeds its 180-second budget | move a spec to the lightest group in `e2e/shards.json` (compare group times in the annotations); never raise the budget |
| owner-guide-coverage | a new desk screen not named in `docs/OWNER-GUIDE.md` | add it |
| a menu test counts links | you added a desk menu link | update the expected count and assert the new link |
| typed value doubled in a form test (e.g. "1012") | typing before the client form loaded its saved value | wait for the saved value to show, then fill |
| "capacity baselines" timing | noisy shared runner | rerun that job once; it is not a gate on its own, but a repeat means look at the change |

## Sandbox notes (agent sessions, learned 2026-10-25)
- `prisma generate` downloads are blocked: set `PRISMA_SCHEMA_ENGINE_BINARY` to any placeholder file and placeholder
  `DATABASE_URL`/`DIRECT_URL` values, then generate. Never commit generated files.
- Full typecheck may run out of memory: `NODE_OPTIONS=--max-old-space-size=5120`.
- A local Postgres may refuse to run as root; database tests then run only in CI (that is fine).
- Production build can't fetch Google Fonts here, so browser specs run only in CI.

Missing owner-only proof is never a CI failure: it is a row in [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md).
