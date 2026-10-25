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
Not started.
