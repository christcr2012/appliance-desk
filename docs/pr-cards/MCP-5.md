# MCP-5 — Assistant actions you approve, done once and checked

Build spec: `docs/build-specs/engines/AGENT-ACTIONS.md`. Design: `docs/mcp/DATA-AND-RECOVERY.md`. Approved by Chris
2026-10-25. Depends on MCP-4, MCP-2, DEC-1a. Risk: **first assistant writes** (settings via decisions, job pause,
backup retry). No money, messages or deletion actions exist.

## Why
Chris wants to hand a completed CPA/attorney form to his assistant and have it apply the answers through the app,
and to let it fix simple problems (retry a failed backup) — with him approving each change.

## One PR
The operation record, approval and the six actions share one execution path; an action without the journal would be
unsafe, and the journal without actions does nothing.

## Acceptance
- [ ] Nothing changes without a preview; in-app approvals need the OWNER; conversation approvals need the preview id.
- [ ] Twenty retries of the same request do the work once (test).
- [ ] A change between preview and execute expires the preview (test).
- [ ] Disconnect, role change or expiry before execute → nothing happens (tests).
- [ ] Uncertain outcomes are checked nightly, never re-run automatically.
- [ ] A filled form's answers apply through DEC-1 exactly as previewed; tampering is refused (test).
- [ ] Assistant activity list with Approve/Decline passes axe, phone/desktop, light/dark.
- [ ] `ci` green at the exact head; every review comment read.

## Progress

**Acceptance plan — 2026-10-27 (before implementation).** Deliver a complete
approved-write path: additive AgentOperation schema and backup/restore policy,
canonical preview and stored arguments, owner approval and decline, locked/fenced
claim, executor using existing domain commands, post-effect verification and
nightly UNKNOWN reconciliation, plus six safe action types. Every action rechecks
the connection grant, actor and role, preview version, TTL and scope. No payment,
messaging, account deletion or unapproved production writes.

**Testable lines:**
- [ ] Same connection/tool/request key/args has one operation; changed args conflict; test 20 simultaneous requests on disposable Postgres.
- [ ] Preview payload bounded and free of secrets; stale change expires; forged hash and arguments fail.
- [ ] OWNER-only in-app approval and explicit preview-bound conversation approval; decline consumes the grant.
- [ ] Disconnect, grant rotation, role downgrade, archival and expiry block execution on real DB.
- [ ] Existing domain command preserves its own authorization; operation lease fencing and readback prevent duplicates.
- [ ] UNKNOWN reconciles through readback only; no automated re-execution.
- [ ] All six action types, DEC-1 answer application and safe backup retry have tests; preview causes no write.
- [ ] Assistant Activity Approve/Decline passes accessible phone/desktop light/dark checks.
- [ ] Exact-head CI and Reviewgate green and every finding dispositioned before merge.

**Dependency:** branch builds on MCP-4 and must not merge until MCP-4 succeeds.


**Checkpoint — October 27, not ready for PR:** A first additive journal
migration and model exist with a backup policy and restore fail-closed behavior.
A preview-only journal service checks current connection grants, role, action
scope and bounded canonical arguments under the connection lock; owner-only
approve/decline locks the connection and operation. No assistant write tool
or business action has been exposed or executed yet.

Evidence: Prisma validation and generation passed; 20-way preview deduplication,
same-key changed-args conflict, OWNER-only approval, disconnection/scope/archival
checks passed on disposable PostgreSQL (4 integration tests). The full
restore drill passed with a RUNNING operation cancelled, its lease cleared,
a SUCCEEDED operation preserved, and the connection revoked (1 integration
test). Backup policy tests 15/15, migration check and changed-file ESLint passed.
The main execute/verify/UNKNOWN reconciliation and owner activity UI still
remain, so MCP-5 is deliberately not called complete or published.
