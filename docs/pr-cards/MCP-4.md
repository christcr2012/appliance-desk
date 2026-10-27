# MCP-4 — The assistant can read health, backups and open decisions

Build spec: `docs/build-specs/engines/CONNECT-AGENT.md` sections 5–6 and the dispatch/transport tests in 8.
Approved by Chris 2026-10-25. Depends on MCP-3, MCP-2 (backup status) and DEC-1a (decision reads). Risk: **a new way
to read data** — every tool re-checks role and scope; nothing writes.

## Acceptance
- [ ] The nine read tools in the spec exist, each with schema, scope and read-only hints (registry test).
- [ ] No tool output contains customer personal details, report text or storage paths (canary test).
- [ ] Two concurrent connections only ever see their own identity (test).
- [ ] Missing scope → tool error `FORBIDDEN_SCOPE`; unknown fields rejected.
- [ ] `ci` green at the exact head; every review comment read.

## Progress

**Acceptance plan — 2026-10-27 (before code).** The branch is stacked on MCP-3 and must not merge before secure OAuth is proven. Implement the **nine complete read-only tools** listed in `CONNECT-AGENT.md` section 6, including `appliance_whoami`:

- Every entry has a stable name, title, safe description, strict Zod input and output schemas, explicit scope (except whoami), and read-only/idempotent tool hints; registry tests enumerate all nine.
- Each domain read uses server-side actor and permission gates. Missing scope fails `FORBIDDEN_SCOPE`, wrong/unknown fields reject, and two concurrent MCP callers never share state.
- Output is bounded and scrubbed. No customer identity, employee/private report text, storage object path, keys or secrets. A unique-PII-canary test must prove that for health, issues, runs, readiness, backups, and decisions.
- Health is schedule-aware; issues use stable diagnostic code and bounded cursor; job runs/backup and readiness report safe state, not raw logs/paths. Decisions only include approved public-to-owner decision wording, never raw private fields.
- SDK initialize, tools/list and tools/call, unknown tool, wrong arguments, GET/DELETE transport, and concurrent-caller tests pass. UI/owner docs, status, route and test inventories stay correct.
- Run quick and focused tests, full CI green **on this branch's exact head**, review findings addressed, then merge only after MCP-3 dependency is green and merged.

No code yet; this is a plan-only checkpoint.
