# MCP-8 — Speed evidence and a map of every setting

Build spec: `docs/build-specs/engines/OPTIMIZATION-COVERAGE.md`. Approved by Chris 2026-10-25. Depends on MCP-5,
MCP-6. Risk: **extra database writes** (sampled, capped, pruned).

## Acceptance
- [ ] Page, action, job and query timings recorded without ids or parameters; 30-day retention; sampling keeps writes small.
- [ ] Observations state window and sample size, and say "Not enough data yet" below 30 samples.
- [ ] Proposals never change anything by themselves; protected settings (prices, fees, legal/tax) are refused.
- [ ] Every Settings field and System health control is on the settings map (test); `appliance_where_is_setting` works.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Implementation is under review on PR #764. The first GitHub CI pass exposed missing backup policy and read-tool inventory fixtures; the root causes were reproduced and corrected together. Local focused observations/control tests are 8/8 green and backup/tool registry tests are 17/17 green; Prisma schema validation and focused ESLint passed. The first corrected exact-head full CI passed. Owner-accepted proposals now open an MCP-6 case with immutable source provenance; new real-PostgreSQL tests check the case and lack of duplicate effects. Fresh exact-head CI and review gate are still required.

## MCP-8 acceptance plan — observations, proposals, and settings map (October 29)

- [ ] Persist only fixed, sanitized PAGE/ACTION/JOB/QUERY names, durations and outcome using sampled bounded instrumentation; a failed metrics write cannot affect the business action. Retain 30 days, deleting no more than 5,000 stale samples per sweep.
- [ ] Display sourced 7-day and 30-day observations, exact p50/p95, error percentages and previous-window deltas. Below 30 samples say "Not enough data yet" and do not infer an improvement or degradation.
- [ ] Proposals store the baseline evidence, expected benefit, risk, cost, verification and rollback; neither creating nor viewing a proposal changes business configuration. Protected price, fee, tax, legal and signature subjects are ineligible.
- [ ] Generate the searchable settings map from the actual AR-8 catalog plus System health controls and decisions, with screen links, role and honest assistant capability labels. Never claim a TOOL row unless its real MCP-5 action and authorization are covered by tests.
- [ ] Owner screen makes observation quality, proposal status and controls visible. Disposable-PostgreSQL tests exercise sampling/privacy, retained boundary, concurrency-safe capped prune, percentile and insufficiency fixtures, proposal denials and catalog coverage; full exact-head CI and review must pass before merging.

This bundle covers the measurement engine, proposal workflow and settings discovery together.
No provider settings are changed, no financial/legal value is auto-tuned, and no
production database is used for test fixtures.

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Required consumers are MCP-5 operations, MCP-6 repair cases and **AR-8’s final settings catalog** (the
   work index lists AR-8). Do not infer a catalog from Prisma alone or maintain a second handwritten copy.
2. Implement the spec’s measurement wrapper with injectable clock/sampler so tests are deterministic. It
   records static route/action/query names only. Assert IDs, query values, email and parameters are absent;
   instrumentation/storage failure must not change the wrapped business operation’s result.
3. Add observation aggregation with 29 vs 30 samples, exact known percentile fixtures, empty windows and
   previous-window comparison; retention deletes at most 5,000 old samples per sweep.
4. Generate the settings map from the real catalog plus actual health controls and decision subjects. Every
   TOOL row must resolve to a tested MCP-5 action; unavailable business writers remain honestly PLANNED.
5. Proposals store observations/measurement/rollback, never change a setting themselves. Test rejection of
   protected financial/legal keys before wiring the owner accept→MCP-6 case workflow. Use the two named
   observation/control tests from the spec and the existing authorization regressions.
