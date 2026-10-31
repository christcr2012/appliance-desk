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
Upstream RTC 1 contract verified and pinned; the acceptance plan is committed. Initial read-only pass issuance/authorization, owner UI, RTC HTTP tool routing, owned 24-hour handles, backup exclusions, and unit/real-database tests are committed on the feature branch. Initial GitHub CI exposed a missing source brace and a generic secret-scanner match on a synthetic rate-limiter fixture; both are corrected without weakening lint or scan rules. First clean-history CI passed secret scan, static checks and all initial browser shards; the next full run identified a CommonJS top-level-await error in the real two-process rate-limit helper and a 360px mobile overflow in System health. Both were corrected without weakening the tests. Exact-head CI at `58d638e` passed before the new scope mapping changes. Owner-selected read areas now map to the actual underlying MCP scopes; catalog discovery is also gated by those same scopes. `tests/mcp-rtc-read-scopes.test.ts` and the updated HTTP catalog tests cover least privilege, missing grants and refusal of implicit feedback-content or write access. New exact-head CI and the upstream full conformance probes remain pending. MCP-8 has now merged as PR #764 (exact-head CI and review gate completed). The present PR #780 remains a read-only foundation; full RTC 1 conformance, carefully confirmed MCP-5 writes and authenticated real-client acceptance are separate unfinished MCP-9 work. Do not mark all MCP-9 criteria complete or claim RTC 1 compatibility from a green source test alone. Passes are read-only; no RTC write permission or live provider integration is activated. Full RTC 1 compatibility is **NOT PROVEN** until the approved write/confirmation and two-process probes pass.

## MCP-9 acceptance plan — pinned RTC 1 protocol, two credential doors and conformance (October 29)

Upstream authority (READ-ONLY): `Robinson-AI-Systems/robinsons-toolkit-hub`,
commit `e6cfb98266728ce0e986ab068569a5d1117a4334`,
`docs/CONTRACT.md` (RTC 1 frozen 2026-10-11), plus
`packages/conformance` from the same commit. Do not edit, deploy,
provision or spend against that repository. RTC 1 requires:
`GET /api/contract`, `GET /api/tools`, `GET /api/tools/{name}`,
`POST /api/tools/{name}`, `POST /api/tools/_batch`,
`GET /api/results/{handle}`, `GET /api/whoami`, `GET /api/openapi.json`;
MCP remains at `/api/mcp`, using a different credential kind.

- [ ] Introduce OWNER-issued pass-only HTTPS credentials: 32 random bytes, `rtc_pass_` plus 43 base64url characters, hash-only persistence, one-time display outside chat, revocation, scope/profile/area limits and definite expiry. The existing OAuth credentials must fail at the RTC door and RTC passes must fail at MCP.
- [ ] Reuse current app MCP catalog and guarded journal/dispatch; reject unknown tools and wrong scopes, read-only pass writes and RTC writes without both wire confirmation and the existing MCP-5 preview/approval. Every allowed change is independently read back and journaled. Never enable live payment/email/SMS/providers.
- [ ] Return RTC 1 manifest, metadata, search/describe, read-only batch (at most ten), scoped calls, owner whoami and OpenAPI; bound outputs to 8 KB and persist handles for 24 hours with same-pass reauthorization. No credential can appear in a URL, result, log or field filter.
- [ ] Persist atomic database-backed rate limits and prove overlapping calls against two processes on one disposable PostgreSQL database. Also prove pass revocation/expiry, scope narrowing, idempotence, 8 KB boundary and connector refresh preserving selected settings.
- [ ] Vendor/pin the upstream RTC 1 named probes under CI at the verified SHA; all applicable probes pass or explicitly remain NOT_PROVEN. Owner System health client matrix and `docs/mcp/acceptance.json` remain NOT_TRIED until a real authorized client connection is witnessed. Runbooks and owner guide describe optional Hub setup without changing other repos.
- [ ] Exact-head CI, required review gate, drift/roadmap/status/database notes and merge requirements all pass before marking complete.

**Resolved specification difference:** The older local MCP-9 build draft proposed 30/90/365-day passes (90 days initially).
Pinned RTC 1 §2 instead specifies 24 hours by default, maximum 30 days for ordinary passes
(hub-specific long-lived exception is separate). Implement the upstream-compatible
24-hour default and 30-day cap, and document that user-facing difference in acceptance.
Do not claim RTC 1 compatibility on app-generated tests alone.

MCP-8 must merge first. The distinct MCP-9 protocol bundle stays separate from
the performance/settings PR. No live pass or production credential will be issued
during tests.

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
