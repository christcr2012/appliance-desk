# MCP-7 — The app watches itself

Build spec: `docs/build-specs/engines/MONITORING.md`. Approved by Chris 2026-10-25. Depends on MCP-1, MCP-5. Risk:
**automatic actions** (only MCP-5 actions, only when Chris turns them on per rule). No new cron entries or paid
services.

## Acceptance
- [x] Built-in checks run once per day even with two workers; threshold, cooldown and recovery behave (tests).
- [x] Alerts are one incident each, on To do; email only when turned on and allowed; a failed email causes no loop.
- [x] Automatic actions run once, show "Approved by your monitoring rule", and stop when the connection is revoked.
- [x] The heartbeat shows when monitoring itself didn't run; `/api/health` exists for an outside uptime check.
- [x] Monitoring settings explained with starting values; `ci` green at the exact head; every review comment read.

## Owner checklist
"Optional: free uptime check" (spec section 3). Never blocks merging.

## Acceptance plan — October 28

1. Built-in monitor rules are owner-configurable and disabled by default; one slot per Denver date is claimed durably so two concurrent workers never run the same rule twice.
2. Two consecutive failures trigger one problem/To do incident; cooldown, recovery and Denver DST are tested on disposable PostgreSQL.
3. Owner-assigned standing authorization never bypasses MCP-5 or revocation; revoked or disabled actions do nothing.
4. Owner email starts off and observes existing live switches; delivery failure cannot generate another incident.
5. The existing sweep does the work, with owner controls, heartbeat, HTTP health probe, mobile/dark UI and full CI.

## MCP-7b implementation evidence — October 29
Feature branch: `ai/chatgpt/mcp-7b-monitor-actions`. The owner UI now pairs one of two
zero-argument MCP-5 maintenance actions with an active maintenance-scoped owner connection.
Automatic dispatch uses a durable one-per-Denver-day MonitorRun receipt linked to the
MCP-5 AgentOperation journal; the operation records its authorizing rule version in the
monitoring-specific tool name. Claims and immediate pre-dispatch both reject revoked
connections, rule changes, disabled rules and deactivated owners. Assistant activity
labels the source "Approved by your monitoring rule"; normal manual operation approval
is unchanged. All rules/actions still start disabled by default.

Evidence so far: focused ESLint zero errors (one unused import corrected), 3/3 focused
monitoring policy tests passed. Four new disposable-PostgreSQL integration assertions
cover owner grants, two-worker uniqueness, connection revocation and disabled rules.
Full TypeScript check could not finish in the 4 GB Vercel Sandbox (heap OOM); GitHub CI
must verify the complete suite and PostgreSQL cases. No production side effect was tested.
The full MCP-7b acceptance remains open until those checks and review are green.

## MCP-7b acceptance plan — delegated monitoring actions (October 29)

- [x] Only an active OWNER can grant, change or revoke standing approval for one allowlisted MCP-5 action and one live connection; the owner UI states the consequence before saving and starts with no action. Reject unknown actions, missing scopes, revoked connections and stale rule versions.
- [x] A qualifying ALERT claims at most one durable operation per unique (rule, Denver slot) even with two workers, and records its operation ID and the authorizing rule version on a permanent receipt. No direct native writer is called.
- [x] Before dispatch, re-read and lock the rule, connection and operation. Rule disable/version change, connection revoke/scope change or owner deactivation after preview must refuse side effects; queued work does not inherit a stale grant.
- [x] Reuse MCP-5 preview, approval and verified dispatch semantics with an explicit standing-rule authorization record. Owner activity labels these receipts "Approved by your monitoring rule". Uncertain effects never retry blindly.
- [x] Disposable-PostgreSQL tests exercise simultaneous workers, replays, revoked/changed authority before dispatch, exactly-once receipts and diagnostic failure. No live email, SMS or payment activation. Focused checks, exact-head CI and resolved review are required.

## Progress — MCP-7a independently usable monitor/owner alert boundary

The daily checks, owner settings, one-incident To do alerts, cooldown/recovery, optional gated owner email, heartbeat and public liveness probe are implemented on ai/chatgpt/mcp-7-monitoring. Eight focused real-database/policy tests passed. This first PR is intentionally independent of delegated assistant writes: that boundary requires an MCP-5 approval/dispatch extension and separate revocation checks; permitting it before the extension would be a security regression. The automatic assistant-action acceptance remains unchecked and MCP-7 as a whole is not complete. Exact-head CI, browser test and review still pending.


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

MCP-7a review correction (Oct 28): treat ACKNOWLEDGED incidents as active across cooldown/recovery and time feedback waits from the newest unanswered update. Two new disposable-PostgreSQL regressions passed; 10/10 focused total. Initial full GitHub CI passed at 32e24511, while the corrected head still requires exact-head CI/review.

## Close-out — October 31 (Lane 5, MCP-7-CLOSEOUT)

Both halves merged in October 2026 — 7a via PR #741 (daily monitoring, alerts,
heartbeat) and 7b via PR #762 (delegated monitoring actions with revocation
fences) — but the card was never closed out: every acceptance box stayed
unticked and the work-index still read APPROVED. Verified on current main
(`965dfeab`) under packet MCP-7-CLOSEOUT; nothing was rebuilt and no behavior
changed.

- **Owner allowlist confirmation (2026-10-31):** before this close-out, Lane 5
  stopped at the allowlist checkpoint and reported the exact shipped list to
  the owner. Chris confirmed it as-is: `MONITOR_ACTIONS` is exactly
  `RUN_DIAGNOSTIC_SWEEP` ("Check system problems again") and
  `RETRY_DATABASE_BACKUP` ("Retry an eligible failed database backup") —
  zero-argument MCP-5 operations only, default OFF, journaled, revocation
  fences intact, no widening.
- **Suites:** `tests/mcp-monitoring-integration.test.ts` re-ran focused on the
  lane database — 11/11 passed (two-worker slot claiming, threshold /
  cooldown / recovery incl. acknowledged incidents, email failure with no
  second incident, DST slot keys, owner-only grants, one linked operation per
  (rule, Denver slot), revocation-after-preview and rule-disable blocking
  dispatch). `tests/mcp-monitoring-policy.test.ts` passed with them (unknown
  actions rejected, settings bounds). The MCP-5 operations suite
  (`tests/mcp-operations-integration.test.ts`) passed 9/10 at the default 5 s
  test cap on this shared VM; its heaviest test (reconciling ten permanently
  uncertain actions) exceeded the cap under multi-lane load and passed with a
  diagnostic timeout raise on a dedicated cluster — a timing artifact of this
  VM, not a failure of the merged code (the same suite was green in CI at
  heads containing this code). Running the suites concurrently against one
  shared database also produced cross-file interference failures that vanish
  when each file runs alone; the per-file runs are the evidence.
- **Implementation read:** monitoring.ts, the standing-grant recheck in
  operations.ts (`checkStandingMonitorGrant`: rule row locked, exact rule
  version + action + connection, live OWNER actor, ALERT receipt required —
  re-read at claim and immediately before dispatch), the Monitoring section
  (explained starting values, owner-only standing-approval fieldset, heartbeat
  with last/next run) and `/api/health` (liveness only, no database) all match
  MONITORING.md. A grant save writes an `mcp.monitor.standing_approval` audit
  entry; Assistant activity labels rule-approved operations "Approved by your
  monitoring rule".
- **Browser:** `e2e/mcp-monitoring.spec.ts` (owner saves and restores a rule;
  accessibility scans) is registered in `e2e/shards.json` and green in CI's
  browser-e shard at heads containing the merged implementation — most
  recently the fully green CI run at `ee975e75` (PR #784).
