# CI-STRAY-1 — Hunt the remaining stray database connection that fails CI from inside browser-style tests

Filed 2026-11-03 as the follow-up to the test-suite health repair (PR #838). Owner decision it
serves: PR #837 (the MCP-9 approval-page repair) stays parked until this card lands — Chris's
Option A re-run was spent on 2026-11-03 and hit its hard-stop condition (below).

## The fault, exactly

A database connection opened by some suite in the shared unit shards is still open when a
browser-style (vmThreads) test file is running. When that connection's socket closes, the
database driver (`pg`) runs a callback that reads a Node global (`process`) which does not
exist in the browser-style environment, so the close throws:

```
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Vitest caught 2 unhandled errors during the test run.
⎯⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯⎯
ReferenceError: process is not defined
 ❯ Connection.<anonymous> node_modules/pg/lib/client.js:226:7
```

Every test passes; the job still fails on the two unhandled errors. The file the error is
attributed to is a **victim, not the opener** — it is whichever browser-style file happens to
be running when the stray socket closes. The named files open no database connection at all.

## Evidence (all read to the ground from the run logs)

PR #837, head `45048d69a574afe2f273a3f5e148286867512efa`, run `41652460687`, job
"unit tests (2/3)" (job `126025386725`):

- **Attempt 2** (2026-11-03): all 2,003 tests passed, zero test failures; the job failed on
  2 unhandled errors with the signature above, attributed to `tests/info-tip-w18.test.tsx`'s
  window (that file renders one glossary component and opens nothing).
- **Attempt 3** (2026-11-03 08:45–08:49 MST) — the single re-run Chris authorized under
  Option A, no code change: Test Files 315 passed | 2 skipped (317); Tests 2000 passed |
  3 skipped (2003); **Errors 2** — the identical signature, first attributed to
  `tests/theme-toggle.test.tsx` ("shows a moon (switch to dark) when currently light"),
  second to `tests/info-tip-w18.test.tsx`. Full log 297,901 chars, log hash
  `abb10081a7f103726051a3a4d0f5e9f89c5d0504cfc447693d03e74a394c1413`. The shard phase read
  212.6 s against the 180 s budget, but over-budget is report-only in the phase script —
  the failure is the unhandled errors, not the clock (same conclusion as PR #838's entry).
- **Attempt 1** failed differently — a payments error (P2020 / 22003). That one is now
  explained and fixed on main by PR #839: the payments-list integration test generated an
  all-digit UUID search tag, and the payment list fed digit-only queries to a Postgres
  `integer` column, which refused the out-of-range value. A real product bug, since fixed;
  it was never this fault.

What Phase 1 (PR #838, main `9ea1f198`) already established:

- A connection-logging census of the whole browser-style project (91 files) found exactly
  two suites opening real database connections (two portal render suites); they now run in
  their own process-pool group (`ui-db` in `vitest.config.mts`) and close the shared client.
  Attempt 3 proves **at least one more opener exists** that the census did not catch — most
  likely outside the browser-style project (a node-pool suite whose connection outlives its
  own pool and closes during a later browser-style window), which is why the census missed it.
- The consent test carried by PR #837 is proven **not** to be an opener (it runs against a
  full `@/lib/prisma` mock, read on the branch).
- Moving the whole browser-style project to the process pool was measured and **rejected**:
  352 s against 102 s, and it broke the website editor accessibility test's frame handling.
  Do not revive it as the fix.
- Reproduction on a coordinator VM did not reproduce the fault in three runs against a
  fresh disposable cluster (declared degraded): local hardware cannot arbitrate this
  timing. The hunt must run in CI's own runner shape.

## The hunt (recommended route)

1. Turn on connection logging on the **CI** Postgres for the unit shards
   (`log_connections` / `log_disconnections`, or `log_statement` sampled) so every
   connection carries the application name / suite that opened it and its close time.
2. Add a per-file connection census **in CI's runner shape** across **all** unit projects
   (not only the browser-style one): for each test file, record which `pg` connections are
   opened and whether they are closed before the file's pool moves on. The opener is the
   file whose connection is still open at the end of its run.
3. Fix at the source: the owning suite closes what it opens (client end / pool drain in
   teardown), following the `ui-db` pattern from PR #838 if the suite genuinely needs a
   real database inside a browser-style render.

## Guardrails

- Never suppress the unhandled-error report, never mark the error "expected", never skip
  or quarantine a test to make the job green.
- Do not raise the 180 s phase budget to hide this; over-budget is report-only already.
- Do not move the whole browser-style project to the process pool (measured, rejected).
- The fix is proven by repetition, not by one green run: this fault is intermittent.

## Acceptance

- [ ] The remaining opener is named: file/suite and the code path that opens the connection.
- [ ] The owning suite closes its connections in teardown; no error suppression anywhere.
- [ ] Three consecutive green `ci` runs at the same head on the fix branch, each including
      the "unit tests (2/3)" job with **zero** unhandled errors.
- [ ] PR #837 then refreshes onto the new main and must pass a fresh push-triggered `ci`
      at its new exact head (the Option A re-run on the old head is spent and failed its
      hard-stop condition; it is not re-run again). Only then do the MCP-9 steps resume:
      merge, testing promotion through the checked promoter, and the trial remainder on
      the testing app only.

## Route decision for the in-Actions census (2026-11-04)

The first-choice instrument was a dispatch-only census workflow, but a workflow
file lives under `.github/`, and the repo's execution-packet guard
(`scripts/work-packet.mjs` `safePath`) refuses any dot-directory path in a
packet — so that workflow could not be packeted work. Two legitimate routes
were considered:

- **Amend the guard** to allow `.github` paths under a narrow scope. Rejected
  for this hunt: the guard's wholesale refusal of dot-paths is what protects
  `.git`, `.env*` and generated trees from packet references, and weakening a
  safety guard — even narrowly — should stand or fall on its own merits, not
  ride along as a side effect of a test hunt.
- **Ride the existing `ci` workflow (chosen).** `.github/workflows/ci.yml`
  already triggers on `pull_request` and `workflow_dispatch`, in exactly the
  runner shape where the fault fires (4 of 4 in Actions, 0 of 5 everywhere
  else). The census instruments therefore live entirely in ordinary packetable
  paths and need no workflow change at all:
  - `tests/stray-census.setup.ts` — a per-worker setup file (wired into all
    four vitest projects) that patches `pg`'s `Client.connect`, recording the
    creating stack and the active test file for every connection, logging
    closes with their age, and naming at each file's teardown any connection
    that file opened and never closed.
  - `scripts/stray-census-global.mjs` — a `globalSetup` sampler in vitest's
    main process that polls `pg_stat_activity` on the CI database and
    summarises long-lived backends and backends still alive at run end.
  - Both are **inert by default**: they activate only when `STRAY_CENSUS=1`
    is set, or when the `scripts/stray-census.ACTIVE` marker file exists.
    The marker exists only on the diagnostic branch
    (`ai/vivienne/ci-stray-1-census`) and is never merged to main.

The guard is therefore neither amended nor bypassed: nothing under `.github`
is added, changed, or referenced by the packet, and the required `ci`
workflow's behaviour is unchanged (the packet's standing invariant). The
conviction must come from the census output in Actions itself — a CONNECT
record naming the file and stack that opened the connection which later
closes inside an innocent browser-style file's window — not from inference.
