# Owner experience, monitoring and launch operations

## Connection experience to implement

System health -> AI assistants -> Connect an assistant. Explain that an MCP-compatible client invokes tools and a scheduled worker is separately configured. Show endpoint and client-neutral steps: add remote MCP URL, sign in with Appliance Desk, inspect requested role/scopes/data, choose policy, allow, then Run connection check. The check reports actual identity, environment, last read and server version without creating a backup or sending a message.

Show connection label/client, who authorized it, effective access, environment, last use, expiry, last action, monitoring enrollment and Revoke. Revoking stops new calls and queued work; show any dispatched operation still awaiting outcome. User-editable policy settings explain dollars rather than cents, known/unknown cost, recommended values and restore-recommended. Do not present a blanket “AI can fix everything” promise.

Existing AI check-up keys remain under Advanced / Legacy check-up access with current behavior, last-used metadata and revoke. Creating one does not enroll monitoring. No automatic migration, key exposure or hidden permission expansion. New passes are an advanced one-time-secret UI for HTTP/CLI/Hub; OAuth setup normally requires no copied secret.

## Reported backup symptoms

Owner reported database backup never succeeded and private photo recovery missing two named settings. Treat as open until actual evidence proves remedy. Read authorized private hosting logs, correlate app revision/run/time, check stage/config presence and provider access without printing values, reproduce the same failure class in isolation, repair through normal review, then verify the real configured path only within authorization. Missing store may require owner or separately delegated infrastructure provisioning; planning does not create it.

A successful database artifact is not photo recovery or verified restoration. UI shows independent Last database copy / Last photo copy / Last integrity check / Last restore rehearsal, dates and evidence kinds. Unknown host-managed recovery status says not verified. No production restore or manual cron replay is authorized by a diagnostic key.

## Monitoring setup

Owner chooses schedule (starting suggestion daily 08:00 America/Denver), channels, thresholds, actions and delegation. Save as disabled draft until the user explicitly enables it. Reuse existing automation scheduling infrastructure; no minute-by-minute database polling just to display freshness. Initial thresholds: daily rule grace two hours, repeated failure two occurrences, cooldown 24 hours; these are editable starting values with reasons, not hard-coded business restrictions. Calendar-sensitive jobs honor their actual calendar rather than interpreting 744 hours as every month.

Separate status of scheduled deterministic checks, optional external AI worker and notification delivery. Record heartbeat, last successful observation, next due, lease/cooldown, queued/in-progress/unknown actions. Issue dedupe key includes rule, failure category and bounded target fingerprint; notify only on meaningful escalation/recovery/new evidence and apply configured cooldown. A worker outage creates one overdue incident. Prevent self-alert recursion when notification delivery itself fails.

Owner notifications default in-app. Email/SMS require existing provider readiness, recipient preferences and actual user authorization. An optional external AI worker may cost money; show provider/estimate or unknown cost and user-selected budget, without turning the developer's $0 rule into a product ban. This plan activates none.

## Reporter support experience

See [FEEDBACK](FEEDBACK.md). Show My reports and reply history, actual progress, whether an AI reviewed it, and an accessible way to reopen or contact a human. Technical incidents, private user feedback and improvement proposals may link internally but have distinct visibility. Reporter notifications never expose internal notes or another reporter's request. Include software vs appliance-service guidance at entry.

## Client acceptance matrix

| Route | Local synthetic prerequisite | Real acceptance receipt |
|---|---|---|
| Official MCP SDK client | SDK initialize/discover/call plus OAuth lifecycle | Tested version, granted scope and exact released source |
| Claude remote connector | Discovery, registration, consent and cached catalog behavior | Actual connect/read, refresh, redeploy read and revoke; no blanket Claude certification |
| ChatGPT/Codex remote client | Same plus supported client-specific setup | Actual supported environment/version and operation; do not conflate ChatGPT UI with Codex CLI |
| Other MCP clients | Standard transport/metadata contract | Individually recorded; “any agent” means compatible clients, not universal certification |
| RTC CLI / local stdio adapter | Existing Hub-provided CLI, no new duplicate CLI | Direct URL read/result and revoked-pass refusal |
| Optional Hub | RTC conformance and owner-scoped pass | Discovery/routed read/result/revocation with actual server/Hub revisions; no custom Hub handler |

Only actual passed cells may be advertised. A client unable to support remote OAuth may use an existing supported RTC/CLI adapter, with explicit setup and independently verified route. Do not weaken authorization to satisfy a client.

## Release, rollback and recovery

Implementations merge into main only with exact-head required CI and reviewed findings. Daily checked main->live releases remain authoritative. No preview/manual deployment demand; no surprise Vercel project. Before live acceptance reconcile actual serving SHA and READY state using hosting evidence, not a service self-report alone.

Rollout: additive schema -> disabled connection/monitor features -> synthetic conformance -> release -> authorized direct diagnostic connection -> scoped recovery proof -> optional monitoring/feedback -> RTC/Hub route. Existing owner-controlled launch/payment/message gates remain intact. Feature switches control rollout, not permanent missing product capability. Connection policy can later enable supported production actions after real authorization.

Rollback: disable new MCP/monitor entry points without reviving credentials, preserve operations and audit, reconcile dispatched UNKNOWN effects, revert application to compatible source, leave additive schema, and keep feedback receipts available or explicitly mark degraded support. Restore rehearsal goes only to isolated target and reapplies deletion tombstones; restore revokes credentials and resets worker grants/leases. A restoration is never inferred from checksum-only evidence.

## Completion receipt

For each M1–M11 criterion record actual source commit, named focused test and exit, exact-head CI, review dispositions, merged PR, required deployed SHA and separate real acceptance evidence. Every open external row has failed attempt/needed authority/responsible actor/re-entry step. No claim of “monitoring enabled,” “fixed,” “RTC 1” or “works in all agents” based on a plan, mock, registry entry, PR or single successful read.
