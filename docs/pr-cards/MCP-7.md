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

## Acceptance plan — October 28

1. Built-in monitor rules are owner-configurable and disabled by default; one slot per Denver date is claimed durably so two concurrent workers never run the same rule twice.
2. Two consecutive failures trigger one problem/To do incident; cooldown, recovery and Denver DST are tested on disposable PostgreSQL.
3. Owner-assigned standing authorization never bypasses MCP-5 or revocation; revoked or disabled actions do nothing.
4. Owner email starts off and observes existing live switches; delivery failure cannot generate another incident.
5. The existing sweep does the work, with owner controls, heartbeat, HTTP health probe, mobile/dark UI and full CI.

## Progress
Building on the MCP-7 monitoring branch; no tests or CI claimed yet.

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. After MCP-5’s final exports exist, implement MONITORING sections 1–2 before its screen. Reuse the
   existing system-issues sweep, automation schedule and issue upsert; do not add another scheduler.
2. Use the spec’s `(ruleKey, Denver slot)` uniqueness plus the repository’s transaction/actor conventions.
   Two workers for one rule/day must yield one run and at most one operation. Fixtures: failures 1 then 2
   alert, another within cooldown does not notify, recovery happens once, DST keeps the correct date key.
3. Reuse MCP-5’s dispatch/rechecks for auto actions, never call native repair writers directly. Test revoking
   the chosen connection or disabling the rule after queueing: no side effect. Email failure records evidence
   without creating a new alert incident. Default disabled, email off, no auto action.
4. Add heartbeat from the existing schedule; `/api/health` is the spec’s process/revision signal, never proof
   the database or monitoring is healthy. Keep the external uptime step as optional owner acceptance.
5. Implement the named monitoring integration/policy tests and the settings browser journey. Add each actual
   setting/control to the AR-8/MCP-8 catalog integration when that export is available.
