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
Not started.

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
