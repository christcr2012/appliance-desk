# Build spec — Watching the app for problems (MCP-7)

Card: `docs/pr-cards/MCP-7.md`. Design: `docs/mcp/OPERATIONS.md` ("Monitoring setup"), `ARCHITECTURE.md`
("Monitoring and intelligence"). Depends on MCP-1, MCP-5. Approved by Chris 2026-10-25. No new paid service, no new
cron entries (cost rule): checks run inside the existing daily `system-issues-sweep` run.

**What Chris gets:** the app checks itself every day and tells him (To do, plus email only if he turns it on and
customer/owner email is live) when something new goes wrong, when it keeps failing, and when it recovers — without
repeating the same alert every day. Optionally, an assistant he trusts can be allowed to run specific safe repairs
(MCP-5 actions) automatically when a specific check fails.

## 1. Data (additive)
```prisma
model MonitorRule {
  id          String  @id @default(cuid())
  key         String  @unique @db.VarChar(60)   // built-in keys below; no custom code or URLs
  enabled     Boolean @default(false)            // saved disabled until Chris turns it on
  failuresBeforeAlert Int @default(2)
  cooldownHours Int   @default(24)
  notifyEmail Boolean @default(false)
  autoAction  String? @db.VarChar(60)            // one MCP-5 action key, or null
  autoActionConnectionId String?                 // the assistant connection allowed to run it
  version     Int     @default(1)
  updatedAt   DateTime @updatedAt
}
model MonitorRun {
  id        String   @id @default(cuid())
  ruleKey   String
  slot      String   @db.VarChar(20)             // Denver business date
  state     String   @db.VarChar(12)             // OK | ALERT | RECOVERED | SKIPPED | ERROR
  consecutiveFailures Int
  notifiedAt DateTime?
  operationId String?                            // AgentOperation started automatically, if any
  createdAt DateTime @default(now())
  @@unique([ruleKey, slot])
}
```
Built-in rules (each maps to existing data, so no new collection): `jobs-late-or-failing` (any health state `late`,
`failing`, `unknown`), `backup-not-verified-today`, `photo-copy-not-paired`, `open-high-issues`,
`assistant-action-uncertain`, `feedback-waiting-3-days`, `heartbeat` (the sweep itself — see 3).

## 2. Running (`src/domains/agent-control/monitoring.ts`)
`runMonitors(now)` is called at the end of `system-issues-sweep` (inside its `runAutomation`, so it runs once per
slot). For each enabled rule: insert `MonitorRun` for `(ruleKey, slot)` (unique = runs once even with two workers);
evaluate; `consecutiveFailures` = previous run's + 1 on failure, 0 on OK; `ALERT` when it reaches
`failuresBeforeAlert` and the last `notifiedAt` for that rule is older than `cooldownHours`; `RECOVERED` when OK after
an alerted run. Alert/recovery → the existing system-issue record (`MONITOR_ALERT` kind, fingerprint
`monitor:{key}` — one incident, not a counter) which already feeds To do; email via the existing owner email
helper only when `notifyEmail` and the email switch allows; an email failure is recorded on the run and does **not**
create another monitor alert (no alert loops).
Auto action: when `ALERT` and `autoAction` is set and the connection is active with the action's scope, create the
MCP-5 operation with `approval` treated as granted by the rule (the rule's saved settings are Chris's standing
approval — shown as such on the activity list: "Approved by your monitoring rule"), then execute it through the same
path. Revoking the connection or disabling the rule stops queued ones at recheck.

## 3. Heartbeat (the check that the checks ran)
The System health page and `appliance_health_get_overview` report `monitoring: { lastRunAt, nextDueAt, state }`
using the MCP-1 schedule for `system-issues-sweep`; `late` when it did not run. Whole-app outages can't be seen from
inside the app: the screen says so and the owner checklist gets one row (once): "Optional: free uptime check" with
steps for a free external monitor pointed at `/api/health` (new `src/app/api/health/route.ts`: returns 200 `{ ok: true }` and the app revision, never touches the database or any secret).

## 4. Screen
System health › **Monitoring**: one row per built-in rule with switch, "Alert after {n} failures in a row", "Don't
repeat for {h} hours", "Also email me", and "Let an assistant fix it automatically: {action} using {connection}"
(OWNER only; shows the action's preview text so he knows what it does). Each setting explained with starting value
and restore recommended (starting values: off, 2, 24 hours, email off, no auto action).

## 5. Tests
`tests/mcp-monitoring-integration.test.ts`: two parallel `runMonitors` → one run per rule/slot; threshold and
cooldown; recovery once; email failure no loop; auto action runs once, refused after revoke; DST slot keys.
`tests/mcp-monitoring-policy.test.ts`: rules can't reference unknown actions; settings bounds. Browser: settings form.
