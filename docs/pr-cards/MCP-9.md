# MCP-9 — Tool-contract compatibility and the honest client list

Build spec: `docs/build-specs/engines/RTC.md`. Approved by Chris 2026-10-25. Depends on MCP-4…MCP-8. Risk: **a
second way in (passes)** — same catalog, same checks. The Robinson toolkit/hub repositories are read-only references.

## Acceptance
- [ ] RTC 1 routes pass the pinned conformance probes; passes and OAuth tokens never cross doors.
- [ ] Rate limits hold across two server instances (test).
- [ ] Results over 8 KB use owned 24-hour handles, re-authorized on read.
- [ ] The client list shows only clients actually tried; nothing marked passed from tests alone.
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist
"Try your assistant connection"; "Optional: connect through the Robinson hub". Never block merging.

## Progress
Not started.

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Read RTC sections 1–3; pin the referenced upstream contract before choosing wire paths/envelopes. If it
   cannot be read, record the exact source problem and continue independent local pass/authorization tests;
   do not invent a compatible-looking contract or modify the upstream repo.
2. Reuse current MCP authorization/catalog and MCP-5’s final dispatcher. Inventory actual exports first:
   `src/mcp/server.ts` exists at this baseline; `catalog.ts` in the spec is a target integration, not evidence
   it already exists. Refactor one shared registry if needed, preserving every existing tool/refusal test.
3. Prove the two doors reject each other’s credential type, expired/revoked passes fail, and queued writes
   recheck both the wire confirmation and MCP-5 preview/approval. Do not bypass scopes with a pass.
4. Test payload at/below/above the specified 8 KB boundary, owned 24-hour result handles, expiry and revoked
   access on handle read. Test limits through two server processes sharing one throwaway database.
5. Add the pinned conformance fixtures and named RTC/client/limit suites. Client acceptance entries start
   NOT_TRIED; test success never marks ChatGPT, Claude, mobile or Hub as actually tried.
