# MCP roadmap — finite outcomes for Sol 5.6

Owner-requested scope, approved to build by Chris 2026-10-25; engineering NOT STARTED. Stable sections MCP-1…MCP-11 below are the design; the implementation-ready build specs are in `docs/build-specs/engines/` (HEALTH-BACKUP, CONNECT-AGENT, AGENT-ACTIONS, REPAIR-CASES, MONITORING, OPTIMIZATION-COVERAGE, RTC, FEEDBACK, FEEDBACK-AGENT) with cards `docs/pr-cards/MCP-*.md`, all registered in `docs/pr-cards/work-index.json`. The people-only feedback box (MCP-10a) can be built first; it needs no MCP connection.

## Delivery order and dependencies

| Suggested coherent delivery | Whole subsections | Prerequisites | Usable result |
|---|---|---|---|
| A | MCP-1 + MCP-2 | Current main; authorized diagnosis separately | Trustworthy backup/media health and actionable explanations |
| B | MCP-3 + MCP-4 | A diagnostic DTO | User can connect directly and diagnose through MCP |
| C | MCP-5 + MCP-6 | B auth/dispatch; A recovery contracts | Authorized, journaled, verifiable recovery and repair cases |
| D | MCP-10 + MCP-11 | B auth plus C operation journal | Users submit feedback; agents privately review and track fixes |
| E | MCP-7 + MCP-8 | C; feedback can feed monitoring after D | Scheduled checks, accountable automation and measured optimization |
| F | MCP-9 | B–E; actual released prerequisites per check | RTC/Hub compatibility and end-to-end release/connection proof |

This is a suggested grouping, not six mandatory PRs or a quota. Target repository 2–5 whole subsections / 400–800 meaningful production lines on average; auth or journal work can warrant a larger single subsection. Never split a helper merely to meet counts, inflate line estimates, invent tests to mirror code, or stop after a push. Medium effort for auth/data/provider work; low for already proved UI/metadata patterns. No stronger-model requirement.

Feedback is the first new user-facing workflow after safe direct connection/recovery plumbing, rather than postponed until Hub completion. An independent owner-approved feedback UI can start earlier once its dependencies exist; no skipping unfinished dependent security contracts. Real provider prerequisites restrict their exact acceptance, not synthetic engineering.

## MCP-1 — Accurate health, safe diagnostics and source evidence

Build: shared exhaustive state vocabulary, schedule-aware freshness, bounded health queries, typed failure codes/stages and setup next steps. Anchors: `getAutomationHealth`, `runAutomation`, `recordSystemIssue`, `SystemIssuesSection`, `AutomationsPage`. Preserve existing fingerprint/version/role semantics.

Acceptance M1: all health states render correctly; stale and never-ran differ and follow timezone/calendar rules; 10,000-run fixture stays bounded; source failures retain useful typed cause without planted secrets/PII; legacy ops API remains its existing limited authority. Tests extend `automation-health`, `automation-runs-integration`, `system-issues-integration`, `ops-redaction`; owner browser verifies mobile/dark/keyboard/axe. See upgrades contract for exact cases.

## MCP-2 — Reliable backup evidence and safe retry boundary

Build: stage-specific artifact outcomes, verified destination privacy/config readiness, successful-upload/failed-prune separation, paginated retention, media domain extraction, persistent database/media linkage and explicit safe retry contract. Update restore/backup coverage for new fields. Investigate actual failure only with real authorized evidence, never guesses.

Acceptance M2: all CAPTURE/UPLOAD/VERIFY/PRUNE/MEDIA failures are distinguishable; invalid/mismatched private store refuses copy; duplicate recovery has one effect; source tombstones survive concurrent copy and restore; last recoverable set is retained; synthetic disposable restore verifies rows/relations/media; provider evidence remains separate. Extend backup/export/restore/media tests and scenario 09. Production logs/config and real recovery rehearsal remain explicit external rows, not assumed passed.

## MCP-3 — Secure connection, consent and lifecycle

Build: supported pinned SDK/OAuth provider, additive schema, canonical issuer/resource discovery, PKCE, client registration options, owner consent/policies/connections, instant revocation/current-role checks, scopes and refresh-settings preservation. Keep legacy keys separate. Use existing login/MFA; no new signup/password system.

Acceptance M3: actual SDK client completes local authorize/token/refresh/revoke; role downgrade, wrong audience, token reuse, redirect/state/PKCE and metadata SSRF tests refuse; concurrent refresh has one valid winner/family semantics; existing login/password reset/customer flows remain green; new auth secrets are excluded from backups; consent/revoke UI works on phone/light/dark/keyboard/axe. Proposed suites `tests/mcp-auth-integration.test.ts`, `tests/mcp-oauth-security.test.ts`, `e2e/mcp-connections.spec.ts`.

## MCP-4 — Direct diagnostic MCP and stable client upgrades

Build: official Streamable HTTP route, guarded registry/meta-tools, initial diagnostic reads, context construction, permissions, bounded outputs/handles, version information and compatibility discovery. Tools return shared diagnostic DTO; no direct provider credentials.

Acceptance M4: SDK initialize/list/search/describe/call/batch/read/result tests and two concurrent distinct callers prove isolation; every alternate door uses identical guards; revoked handle and unsupported version refuse; established connection still reads after compatible redeploy/refresh without signing in again; compact catalog fits budget. Proposed `tests/mcp-dispatch.test.ts`, `tests/mcp-transport-integration.test.ts`, `tests/mcp-results-integration.test.ts`. Real host cache behavior tracked separately in M9.

## MCP-5 — Operation journal, preview, authorization and recovery

Build: schema and operation algorithm from DATA-AND-RECOVERY; action registry; dry run, policy or bound approval, idempotency, fencing/budget reservation, readback and unknown reconciliation; owner action history. Native actor/target gates remain inside domain commands.

Acceptance M5: same-key 20-way race yields one effect; changed args reject; two target versions conflict; simultaneous 700+700 reservations under 1000 test budget permit one; revoke-before-dispatch refuses; crash-after-provider stays UNKNOWN then reconciles once; stale worker cannot overwrite; dry run changes no business/provider data; completed readback is honest. Proposed `tests/mcp-operations-integration.test.ts`, `tests/mcp-recovery-integration.test.ts`, `e2e/mcp-recovery.spec.ts`; existing automation/provider tests continue to pass.

## MCP-6 — Evidence-bound software repair and issue verification

Build: repair case transitions, sanitized evidence packaging, allowed repository/PR/CI linkage, deployed source verification, owner To do/status, independent runtime verification. Existing GitHub/Vercel/Neon tools remain separate authorities. No arbitrary shell/SQL tool.

Acceptance M6: case retains original issue/version; fabricated/foreign PR and untrusted CI URL reject; PR open/merged/deployed/verified are distinct; authorized operational recovery is rechecked, failed verification keeps issue open; source code fixes are exercised with synthetic data; rollback targets compatible application source without overwriting database. Proposed `tests/mcp-repair-cases-integration.test.ts`; integration fixture creates a local fake-provider PR/CI chain. Real cross-tool execution requires separate explicit credentials/authorization and its own receipt.

## MCP-10 — Private in-app problem reports and improvement suggestions

Build: reporter UI/My reports, support models/entries, optional safe screenshot namespace/authorization/sanitization, per-report AI opt-in/withdrawal, role-scoped triage and privacy export/deletion coverage. Reuse existing maintenance for appliance-service concerns. See FEEDBACK for complete scope.

Acceptance M10: FEEDBACK cases 1–3, 6 and 8; customer cross-access fails at every route/action/download/cursor; double-submit once; safe context; uploader binding/quarantine/EXIF/size guards; human-only stays human-only; deletion/restore does not revive content. Proposed `tests/feedback-integration.test.ts`, `tests/feedback-media.test.ts`, `e2e/feedback.spec.ts`, extended privacy/media tests. Register browser spec in existing shards.

## MCP-11 — Agent feedback triage, conversation and repair tracking

Build: scoped MCP feedback tools, in-app replies with author labels, internal/reporter separation, case/duplicate linking, optimistic transitions, withdrawn-consent propagation and evidence-backed resolution/reopen.

Acceptance M11: FEEDBACK cases 3–8 end to end; a report becomes sanitized case -> actual staged repair evidence -> checked deployment -> independent verification with honest reporter wording; no public private-content leak; malicious report triggers no unauthorized tool; reporter can reopen; no required live email. Proposed `tests/mcp-feedback-integration.test.ts`, `tests/feedback-workflow-integration.test.ts`, shared feedback browser journey.

## MCP-7 — Deterministic monitoring and owner-selected agent automation

Build: configurable checks/schedule/threshold/cooldown, durable slots/leases/cursors/outbox, delegated action rules, local timestamps, health heartbeat and existing owner notification/To do integration. Optional external AI worker has its own stored delegation; no model chosen or paid scheduler provisioned.

Acceptance M7: two-worker overlap runs once; restart resumes; stale lease fenced; schedule/DST/no-data/backoff/cooldown correct; notification rejection retries without duplicates; heartbeat detects missed worker; unauthorized production action refuses while explicitly delegated synthetic end-user action works; revocation stops queued execution. Proposed `tests/mcp-monitoring-integration.test.ts`, `tests/mcp-monitoring-policy.test.ts`, monitoring UI browser checks. Total app outage requires independently observed hosting monitor; lack of that evidence stays open.

## MCP-8 — Optimization evidence and owner control coverage

Build: aggregate performance/error/backlog metrics with retention/cardinality caps, proposal baseline/benefit/risk/verification/rollback, settings navigation map and capability inventory of system maintenance/security/backup/monitor/feedback controls. Implement each API-backed in-scope control as a typed command; provider-only infrastructure controls get correct service handoff and verification. Ordinary rental/billing domain expansion beyond maintenance is future explicit adapter scope, not an excuse to expose raw database access.

Acceptance M8: metrics prove window/sample/provenance and suppress sensitive dimensions; insufficient sample says unknown; no proposal silently executes; every in-scope settings row has a tested command or genuine provider-manual reason; entitled user can execute supported production-affecting synthetic action while developer restrictions remain binding. Proposed `tests/mcp-observations.test.ts`, `tests/mcp-control-coverage.test.ts`, owner explanation browser checks.

## MCP-9 — RTC conformance, client matrix and final operational proof

Build: pass-only RTC adapter/endpoints/OpenAPI, owner pass UI, profile/listing, shared dispatch, conformance harness pin, two-process durable limits, permission-safe logs/results and optional Hub/CLI route setup. Finish owner/runbooks, backup/update/revocation/recovery drills and declared client matrix. Advertise only conformed capability.

Acceptance M9: upstream RTC required probes pass including own two-process shared-DB limiter; direct MCP and RTC see equivalent authority; refresh preserves all selections; revoked/expired pass and key leakage probes refuse; direct host/CLI/optional Hub read succeeds with exact route receipt; compatible redeploy preserves connection; every implemented acceptance row has source+test+CI+release/evidence or precise still-open prerequisite. No actual Hub dependency for direct acceptance. Proposed `tests/mcp-rtc-integration.test.ts`, `tests/mcp-two-instance-limits.test.ts`, `tests/mcp-client-contract.test.ts` plus pinned upstream suite.

## Gates and closeout

Real owner credentials, production log access, hosting storage configuration, third-party agent setup, real backup/restore and optional Hub route are not proven by local tests. Record exact prerequisite, owner/actor, source SHA and re-entry action in acceptance.json and the existing acceptance ledger when engineering activates. Daily release remains the existing policy; nothing here authorizes manual release, live payments/messages, provisioning or spend. Do all independently eligible engineering before declaring blocked.
