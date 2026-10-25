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
