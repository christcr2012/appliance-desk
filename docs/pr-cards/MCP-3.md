# MCP-3 — Connect an AI assistant safely

Build spec: `docs/build-specs/engines/CONNECT-AGENT.md` sections 1–4, 7 and the auth tests in 8. Design:
`docs/mcp/SECURITY.md`, `ARCHITECTURE.md`. Approved by Chris 2026-10-25. Depends on MCP-1. Risk: **sign-in,
sessions, new login-related tables** — read `docs/AI-PR-READ-FIRST.md` and say in the PR how each auth item is honored.

## Why
Chris wants to point an assistant (Claude) at his app to check its health and work through his open questions,
without making or pasting secret keys.

## Split from MCP-4
MCP-3 is the sign-in, consent and disconnect machinery (auth risk, reviewed on its own); MCP-4 adds the tools on top.
MCP-3 ships `appliance_whoami` only, so the full sign-in → call → disconnect path is proven in this PR.

## Acceptance
- [ ] An SDK client completes authorize → consent → token → refresh → whoami against a local issuer (test).
- [ ] Disconnect stops the next call at once; role downgrade or archive stops it (tests).
- [ ] Wrong audience, other issuer, tampered or expired token, bad redirect, missing PKCE → refused (tests).
- [ ] Issuer comes only from `MCP_ISSUER_URL`; unset → every route 404.
- [ ] OAuth tables are left out of backups; restored connections come back disconnected.
- [ ] Public sign-up still disabled; existing login, second step and password reset suites unchanged and green.
- [ ] Consent page and the AI assistants card pass axe, phone/desktop, light/dark, keyboard.
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist
"Connect Claude to Appliance Desk" (spec section 9). Never blocks merging.

## Progress
Not started.
