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

## Full CI correction evidence — October 28

After exact-head CI identified stale tool counts, missing serial-test
classification, an invalid manually seeded approval grant and a keyboard
heading-selector collision, we repaired each at its source. The books poster
suite now runs in the serial shared-settings project because it changes the
singleton books-start setting. All 37 focused disposable-PostgreSQL
integrations (19 books + 18 assistant) passed without skips, plus eight
read-tool/catalog and serial-inventory tests. Full hosted browser checks and
exact-head CI and review-gate are still mandatory before merging.

## Review correction evidence — October 28

The three Codex findings on PR #717 are fixed in one bounded patch: grant
rotation is checked on owner approval, preview retry, read and both execution
gates; every native DEC-1 evidence row carries its own operation ID and matches
the preview's normalized expected answer; nightly readback rotates UNKNOWN
operations by persistent last-checked time. A dedicated additive migration
adds the evidence columns without rewriting existing data. All **18 focused
disposable-PostgreSQL tests pass**, including 20 concurrent executions,
disconnect/re-authorize safety, unrelated decision evidence, value tampering
and 10-item starvation regression. Focused TypeScript, migration safety,
owner wording and route inventory passed; GitHub CI/browser, review replies
and dependency MCP-4's separate protected merge are still outstanding.
No production data or provider modes were changed.

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

**Further checked (2026-10-27):** Preview and owner decisions now also write limited audit entries (operation action/reference only, never the arguments or answers); owner approval rechecks the connecting actor's live role and grant. The disposable-Postgres suite still passes all four cases including post-preview role downgrade. The operation dispatcher, reconciliation, domain actions and owner activity UI remain unbuilt.

**Implementation checkpoint — October 27 (not mergeable yet).** Added strict
action argument parsing, original-preview version hashes, locked one-time claim,
durable attempt and lease token fencing, native command dispatch, post-command
readback, and midnight reconciliation of UNCERTAIN without blind retries.
Assistant activity shows bounded previews and owner Approve/Decline with a
keyboard-focused confirmation table. Existing backup retry accepts a stable
operation run key; existing automation pause rechecks the OWNER and expected
state in its native transaction. Added concurrency/crash-recovery fixtures and browser accessibility
coverage. The focused disposable-Postgres probe passed **11 of 11** journal/
execution tests; browser and exact-head CI remain outstanding. Local TypeScript preflight hit sandbox OOM; only exact-head
GitHub CI can finish required type/build verification.

**Safety test update (October 27).** Disposable PostgreSQL probe now passed
**16/16** journal/execution/real DEC-1 integration tests, zero skipped:
twenty-way duplicate execution, owner/role/disconnect gates, changed targets,
stale worker fencing and readback after lost replies; real DEC-1 immediate
settings, future scheduled answer, "Other" evidence and tampered args.
The native backup scheduler rejects non-UUID run keys, so the journal now
derives a stable UUID-shaped key from the operation id. UNKNOWN alerts required
an additive `SystemIssue_kind_known` migration; the new constraint retains
all previous kinds. A focused TypeScript check passed with the MCP-5 files.
These checks are **not** full GitHub CI or browser evidence.
