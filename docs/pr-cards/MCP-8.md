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
