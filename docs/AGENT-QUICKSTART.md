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
| gitleaks / secret scan | key-shaped string in code, docs or tests | remove it; build fake keys at runtime in tests |
| typecheck: unused `@ts-expect-error` | importing a `.mjs` that already has types | delete the comment |
| scenario test flaky / wrong counts | `tests/scenarios/**` share one database | purge queues with `purgeScenarioQueues`, count only rows you caused, never depend on another file's leftovers |
| a11y/axe failure on a touched page | missing label, focus ring or contrast; `sr-only` text inside an `overflow-x:auto` box needs a `relative` wrapper | fix the markup; never skip the test |
| "capacity baselines" timing | noisy shared runner | rerun that job once; it is not a gate on its own, but a repeat means look at the change |

Missing owner-only proof is never a CI failure: it is a row in [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md).
