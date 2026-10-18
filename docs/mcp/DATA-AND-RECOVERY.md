# Data contracts, operation journal and migrations

This is the reviewed target shape for JIT schema work, not applied Prisma. Preserve the existing single-business schema and role policy. Every new table is assigned an explicit backup policy, population upgrade, retention rule and restore test. Never copy credential hashes into business archives.

## Proposed records

| Record | Required fields and invariants |
|---|---|
| AgentConnection | id, actorId FK, clientId, kind CONNECTOR/PASS/SERVICE, instanceId, environment, label, scopes Json validated, areas Json validated, profile, listing, policyId/version, created/expiry/revoked/lastUsed; index(actorId,revokedAt), index(expiry). Existing OAuth provider tables hold actual tokens/codes; avoid duplicate token stores. |
| AgentPolicy | id, ownerActorId, version, preset, allowedActions/resources/environments, approvalMode, optional budget minor units/window, allowedDeliveryChannels, schedule limits, createdAt; unique(id,version) via immutable revisions or policy+revision tables. Revoking current policy invalidates its connection grants. |
| AgentPass | id, connectionId FK, digest unique, expiry, revokedAt; pass metadata only; OAuth provider tables supply connector token lifecycle. Never migrate old OpsAgentKey into it. |
| AgentOperation | id, connectionId, actorId, instanceId, environment, tool/action, targetKind/ref, requestKeyDigest, canonicalArgsHash, expectedVersion, previewHash, policyVersion, state, leaseOwner/token/expiry, attempt, authorizedAt, started/finished, safeResult Json, evidenceRefs, failureCode/stage, nextAction; unique(connectionId,tool,requestKeyDigest); index(state,leaseExpiry). |
| AgentApproval | id, operation/preview ref, connectionId, actorId, target+args hash, policyVersion, sourceVersion, expiry, consumedAt; only owner/session approval command creates it; lock on consume. No reusable boolean approval row. |
| AgentResult | id/opaqueHandle digest unique, connectionId, actorId, instanceId, environment, minimumScopes, expiresAt, sanitized payload; index(expiresAt); authorization rechecked on read. |
| AgentChangeLog | immutable id, operation/preview ref, actor/grant, action, safe target, before/after safe summaries, outcome, UTC time, provider evidence class; no raw args, private content or tokens. |
| AgentMonitorRule | id, owner/delegation ref, schedule/timezone, conditions, threshold/window, severity, cooldown, action enum, channels, enabled, version, lastRun/nextDue; arbitrary code/URLs forbidden. |
| AgentMonitorRun | id, ruleId, slot, state, lease/fencing token, cursor, safe counts, receipt, started/finished/heartbeat; unique(ruleId,slot); database claim, no memory-only cron lock. |
| RepairCase | id, source incident/report relation, owning actor, status/version, safe evidence, baseline revision, expected behavior, source repo allowlist, PR number, merged/deployed/verifying revision, verification receipt, blocker; no source credential. |
| SystemIssue / AutomationRun extensions | Add optional failureCode/stage/correlationId, evidence refs, durable completion/attempt linkage; old rows remain readable as UNKNOWN provenance, never backfilled with invented facts. |

Feedback-specific records and visibility are in [FEEDBACK](FEEDBACK.md). Do not make user reports a `SystemIssue.detail` string or leak private support text through the existing ops API.

## Durable write algorithm

1. Validate/authenticate and load current role, target, grant/policy and expected version. Produce a deterministic safe preview; a dry run may record a preview audit but creates no business effect, provider call, lease or budget charge.
2. Begin short transaction: lock current actor/grant/policy and target in stable order (actor -> connection -> policy -> operation -> domain target -> budget window). Recheck role, archive, revoke, policy, versions, domain gates and approval. Insert or load unique request key. Same key/different args is CONFLICT; same completed command returns its prior outcome. Reserve optional user budget atomically. Record authorized operation and command/outbox intent together; commit.
3. For database-only writes, execute the native command inside its supported transaction with audit and target version compare-and-set. Do not invent a second unlocked read/write path. If a native command lacks transaction support, refactor its narrow core and preserve its existing callers/tests.
4. For provider work, claim a fenced lease and call the existing idempotent adapter after commit. Stable provider idempotency key derives from persisted operation ID. Do not hold database locks over network IO. Command workers recheck authorization before first dispatch. Revocation after dispatch cannot undo effects: record receipt and finish reconciliation, refuse new writes.
5. Persist result/evidence and read back authoritative state. `SUCCEEDED` requires supported verification; `UNKNOWN` on timeout/crash after possible dispatch; `FAILED` only with evidence of failure. `PARTIAL` carries child outcomes and remaining work. A missing response is never proof of no effect.
6. Reconcile uncertain provider outcomes before retrying. If the provider offers no idempotency/readback, require an evidence-backed manual reconciliation path, not an automatic new operation. Unknown cost holds its reservation until reconciled or explicitly reviewed; refund budget only when no effect is proven.

States: PREVIEWED -> AWAITING_APPROVAL or AUTHORIZED -> QUEUED -> RUNNING -> SUCCEEDED/FAILED/UNKNOWN/PARTIAL; DENIED/CANCELLED are terminal before effect. A no-effect replay returns the same ID and evidence; an explicit retry of a proven failed operation references its prior ID and a new authorized attempt, not a silent new daily run. Cancellation stops only work not yet dispatched; never claim it reversed provider effects.

## Existing automation integration

`runAutomation` currently treats any final daily slot (including FAILED) as ALREADY_RAN; its UNKNOWN retry loop can create another attempt without proving external outcomes. Do not globally change this behavior for money/message jobs just to support backup retries. Introduce an explicit recovery command linked to original run and action-specific safe replay policy; normal cron retains its existing contract until independently reviewed.

A stable run attempt records its actual terminal outcome. ALREADY_RAN must carry the persisted outcome; callers cannot treat a failed or still-running predecessor as successful. Media copy must reference a verified database artifact; an ALREADY_RAN branch with null local URL must resolve persisted artifact evidence. Do not run media copy merely because a string says ALREADY_RAN.

## Migration delivery order

1. MCP-1/2 additive diagnostic fields/artifact metadata with nullable defaults, indexes and safe error mapping; keep old backup formats readable.
2. MCP-3 OAuth provider's generated schema, connections/policies/pass links; map exact plugin tables in card, keeping existing auth rows. Exclude all bearer/refresh/code/pass/approval secrets from backups; restored connections default revoked and require reauthorization.
3. MCP-5 journal/approval/result/audit and optional budget reservation; test concurrent execute, crash/restart, unknown state and cleanup. Introduce immutable case links without changing existing customer legal evidence.
4. MCP-7 monitor/rule/run/outbox and retention; build on existing automation/messaging rather than a second delivery stack.
5. MCP-10 feedback records and private attachment relations; population upgrade does not make existing photos public or reopen deleted content.

For each migration: update `prisma/schema.prisma`, `docs/DATABASE.md`, `src/domains/backup/manifest.ts`, restore table ordering, schema-health and populated-upgrade assertions. Archive auth-free evidence where appropriate; exclude ephemeral handles/leases. Restore clears scheduling leases and prevents automatic reactivation of restored worker grants. Keep privacy tombstones and suppress deleted feedback/media. No down migration deleting real evidence; application rollback uses additive-schema compatibility.

## Concurrency fixtures

Use two server processes, one disposable Postgres database, two actors and two connections. Twenty simultaneous same-key retries must yield one operation/effect; two distinct keys competing for one target version yield one transition and one conflict. In a 1000-minor-unit user budget, simultaneous 700-unit reservations permit only one. A revoked grant cannot finish a not-yet-dispatched command. Simulate crash immediately before/after provider receipt and before result persistence; reconcile to one effect. Test a stale lease worker cannot overwrite the newer fenced attempt. These are test fixtures, not production pricing or caps.
