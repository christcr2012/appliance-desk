# MCP-4 — The assistant can read health, backups and open decisions

Build spec: `docs/build-specs/engines/CONNECT-AGENT.md` sections 5–6 and the dispatch/transport tests in 8.
Approved by Chris 2026-10-25. Depends on MCP-3, MCP-2 (backup status) and DEC-1a (decision reads). Risk: **a new way
to read data** — every tool re-checks role and scope; nothing writes.

## Acceptance
- [x] The nine read tools in the spec exist, each with schema, scope and read-only hints (registry test).
- [x] No tool output contains customer personal details, report text or storage paths (canary test).
- [x] Two concurrent connections only ever see their own identity (test).
- [x] Missing scope → tool error `FORBIDDEN_SCOPE`; unknown fields rejected.
- [ ] `ci` green at the exact head; every review comment read.

## Progress

**Acceptance plan — 2026-10-27 (before code).** The branch began stacked on MCP-3; MCP-3 merged as PR #692 before MCP-4 was published. Implement the **nine complete read-only tools** listed in `CONNECT-AGENT.md` section 6, including `appliance_whoami`:

- Every entry has a stable name, title, safe description, strict Zod input and output schemas, explicit scope (except whoami), and read-only/idempotent tool hints; registry tests enumerate all nine.
- Each domain read uses server-side actor and permission gates. Missing scope fails `FORBIDDEN_SCOPE`, wrong/unknown fields reject, and two concurrent MCP callers never share state.
- Output is bounded and scrubbed. No customer identity, employee/private report text, storage object path, keys or secrets. A unique-PII-canary test must prove that for health, issues, runs, readiness, backups, and decisions.
- Health is schedule-aware; issues use stable diagnostic code and bounded cursor; job runs/backup and readiness report safe state, not raw logs/paths. Decisions only include approved public-to-owner decision wording, never raw private fields.
- SDK initialize, tools/list and tools/call, unknown tool, wrong arguments, GET/DELETE transport, and concurrent-caller tests pass. UI/owner docs, status, route and test inventories stay correct.
- Run quick and focused tests, full CI green **on this branch's exact head**, review findings addressed, then merge only after MCP-3 dependency is green and merged.

No code yet; this is a plan-only checkpoint.

**Implementation evidence — October 27:** All nine MCP SDK tools are registered on a fresh
server per authenticated request, with explicit strict input/output Zod schemas, role/scope
checks, read-only hints, safe DTOs and bounded valid JSON responses. Backup status is based
on the verified artifact ledger, not an optimistic scheduled-run flag. Diagnostics strip
freeform reports, answer histories, provider errors and private storage paths.

- `tests/mcp-read-tools.test.ts`: 4 passing tests (nine-tool registry, errors, session
  isolation, large-page cursor).
- `tests/mcp-diagnostics-privacy.test.ts`: 3 passing tests, including a canary embedded
  in private reports, provider fields, references, settings and decision answers. That test
  caught and fixed an over-broad correlation-reference rule.
- `tests/mcp-read-role-integration.test.ts`: passed on a fresh local disposable
  PostgreSQL with migrations and seed; confirms role downgrade and account archive
  block a previously authorized tool call.
- Changed-file ESLint passed. Full local typecheck exhausted the sandbox's 3 GB
  Node.js heap; exact-head GitHub `ci` and `review-gate` are mandatory before merge.

**Review follow-up — October 27:** Codex identified that health's full 37-job catalog
could be silently truncated and that later decisions were inaccessible. Both reads
now accept strict cursors and bounded page sizes; if the 8 KB cap trims a page,
the cursor is set to its final returned entry. Four additional tests cover the
full 37-job/41-decision catalogs, SDK cursor input, and output-budget truncation.
Focused SDK/privacy test suite now passes 11/11; changed-file ESLint passed.
Review-thread replies/resolutions and GitHub exact-head CI remain required.
