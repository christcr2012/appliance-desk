# Build spec — Tool-contract compatibility and final proof (MCP-9)

Card: `docs/pr-cards/MCP-9.md`. Design: `docs/mcp/ARCHITECTURE.md`, `CONTRACT.md` ("RTC adapter"),
`OPERATIONS.md` ("Client acceptance matrix"). Depends on MCP-4…MCP-8. Approved by Chris 2026-10-25.

**What Chris gets:** besides the direct connection (MCP-3/4, which is all most assistants need), the app also speaks
the Robinson tool contract (RTC 1) over plain HTTP with a one-time "pass", for command-line tools and the optional
Robinson hub. This unit also records, honestly, which assistants have actually been tried.

Boundaries (AGENTS.md): the Robinson toolkit and hub repositories are **read-only references** — read RTC 1 from the
hub's public `docs/CONTRACT.md` at a pinned commit (record the sha in this file when building); never change those
repositories or their hosting. No Hub account, pass or route is created by development.

## 1. Passes (additive)
`AgentPass { id, connectionId (an McpConnection of kind PASS), digest Char(64) unique, label, scopes String[],
expiresAt, revokedAt, lastUsedAt }`. Created on System health › AI assistants › Advanced › "Make a pass" (OWNER):
shown once (same pattern as the old check-up key: 32 random bytes base64url, stored as sha256), expiry 30/90/365
days (starting 90). `McpConnection` gains `kind String @default("CONNECTOR")` (`CONNECTOR | PASS`). OAuth tokens never
work on RTC routes and passes never work on `/api/mcp` (tests).

## 2. Routes (`src/app/api/tools/**`, `src/app/api/results/[handle]/route.ts`)
Implement exactly the RTC 1 paths and envelopes from the pinned contract (manifest, search, describe, call, read-only
batch ≤ 10, whoami, results). All call the **same catalog and dispatcher** as MCP (`src/mcp/catalog.ts`,
`src/domains/agent-control/operations.ts`); writes require the RTC wire `confirm` field **and** MCP-5's preview +
approval rules. Results over 8 KB → first part + a handle (`AgentResult` table: digest, connectionId, expiresAt 24 h,
sanitized payload) re-authorized on read. Rate limits use `isRateLimited` (database-backed, so they hold across two
server instances — tested with two processes).

## 3. Conformance and matrix
- `tests/mcp-rtc-integration.test.ts`: the pinned upstream conformance probes (vendored as test fixtures with their
  commit sha, not as a dependency), revoked/expired pass refused, key-leak probes (pass in query string refused,
  never logged).
- `tests/mcp-two-instance-limits.test.ts`: two Next servers on one throwaway database share limits.
- `tests/mcp-client-contract.test.ts`: the MCP and RTC doors return the same refusal for the same unauthorized call.
- `docs/mcp/acceptance.json`: one entry per client in the OPERATIONS matrix with `status: "NOT_TRIED"` until a real
  try is recorded by Chris or an authorized session (date, client version, app revision). Nothing is marked passed
  from tests alone. The System health card lists "Tried with: …" only from entries marked passed.

## 4. Owner checklist rows (once each)
"Try your assistant connection" (Claude; optional ChatGPT/Codex) and "Optional: connect through the Robinson hub" —
exact steps, ready when MCP-9 is live, it worked when System health shows the client under "Tried with". Never block
merging.
