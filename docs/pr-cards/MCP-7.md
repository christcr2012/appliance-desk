# MCP-7 — The app watches itself

Build spec: `docs/build-specs/engines/MONITORING.md`. Approved by Chris 2026-10-25. Depends on MCP-1, MCP-5. Risk:
**automatic actions** (only MCP-5 actions, only when Chris turns them on per rule). No new cron entries or paid
services.

## Acceptance
- [ ] Built-in checks run once per day even with two workers; threshold, cooldown and recovery behave (tests).
- [ ] Alerts are one incident each, on To do; email only when turned on and allowed; a failed email causes no loop.
- [ ] Automatic actions run once, show "Approved by your monitoring rule", and stop when the connection is revoked.
- [ ] The heartbeat shows when monitoring itself didn't run; `/api/health` exists for an outside uptime check.
- [ ] Monitoring settings explained with starting values; `ci` green at the exact head; every review comment read.

## Owner checklist
"Optional: free uptime check" (spec section 3). Never blocks merging.

## Progress
Not started.
