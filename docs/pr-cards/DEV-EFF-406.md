# DEV-EFF-406 — isolated PostgreSQL probe and throughput guidance

Baseline: main 374e74a6ef42aecc8b0109851995963de9457feb (#405).
Scope: development infrastructure only; W-22 still PARTIAL, W-23 blocked.
Status: MERGED (#406) after required exact-head CI and review. No financial behavior or migration.

## Actual evidence and drift
- scripts/preflight.mjs intentionally runs relatedSources(changed) as part of publication checks. This caused a nominal single-spec probe to expand into roughly 1,131 affected specs in an observed run (anti-stall runbook). Preserving this mandatory regression coverage matters.
- scripts/local-postgres-test.sh already isolates Postgres, strips live-provider credentials and runs skip checks. A convenient explicit single-spec diagnosis was missing.
- package.json check:preflight and scripts/preflight.mjs are existing regression entry points.
- This sandbox lacked a remote.origin.fetch configuration: git fetch origin main left origin/main at #404 while remote HEAD was #405. Explicit refspec and new clean worktree corrected it.
- No authentication/payment code was consolidated in an infrastructure PR: those risks need independent reviewed contracts.

## Reusable exact-file recipe
1. Inspect mandatory scope: npm run preflight -- --plan --db tests/exact.test.ts.
2. For bounded diagnostic debugging only, run npm run test:db:probe -- tests/exact.test.ts. The new scripts/probe-db.mjs validates existing, literal tests/*.test.ts files, deduplicates selections, uses disposable scripts/local-postgres-test.sh --checks --inside, blocks options/traversal and reports time and failure.
3. The isolated probe does not expand the import graph. It is never acceptable as publication evidence on its own: run full preflight and exact-head CI under AGENTS/PLAYBOOK.
4. scripts/probe-db.test.mjs covers invalid paths, selectors, no related graph, timeout/CI and failure propagation, and is registered with the existing CI preflight test script.
5. Use this probe for first-error isolation, then run targeted affected-graph preflight and all mandatory review and merge gates.

## Completion evidence and handoff
Local test results and exact-head checks must be added to the PR description. Merge gate: exact-head CI, review and checks must pass before the PR is actually merged. Next W-22C5 must implement immutable per-agreement customer-facing amount/tax evidence and guarded send/sign under IN-79, separately from this tooling upgrade. No CPA approval, live money, or communication is inferred.
