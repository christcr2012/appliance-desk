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

**Engineering acceptance plan — 2026-10-26 (before code).** Ship an independent OAuth
connection/consent/revoke PR (auth boundary), after first reading the installed SDK
type definitions and the repo's identity/2FA rules. Acceptance requires:
- Issuer and redirect/PKCE/registration validate fail-closed in every environment.
- Additive OAuth tables and connection ledger with **no OAuth secrets in backups**;
  restored connections are revoked.
- A real SDK client completes sign-in → token → refresh → whoami on disposable
  Postgres. Role downgrade/archiving/revocation, token replay, spoofing and
  concurrency reject; no previous sign-in pathway changes.
- Owner/admin can approve and revoke on a working phone/desktop connection UI,
  with keyboard and axe coverage. Staff/customer cannot.
- CI green and every PR review thread addressed before merge; no real credentials,
  live-provider operation or manual deployment.

This card and plan commit are not proof of implementation. Nothing is released yet.


### Verified incremental work, October 27 (still unshipped)

The current branch incorporates merged MCP-2 (#611) and main through bc204189.
Four issuer/redirect/scope checks, nine MCP request-authority tests and four streamed
size-cap tests passed locally (17/17). A disposable PostgreSQL instance applied the
OAuth migration and passed three real-database revocation tests, including concurrent
submissions, cross-account access and a role downgraded after sign-in. Disconnect now
atomically revokes the connection, OAuth access/refresh grants and consent.
Owner connection inventory includes admins' connections. The resource-client import
uses the SDK's actual resource-client export, not the obsolete build-spec spelling.

NOT COMPLETE: real OAuth SDK authorize/consent/token/refresh/whoami roundtrip,
registration and metadata SSRF adversarial coverage, owner phone/keyboard/axe proof,
full TypeScript/quick check, CI and review. The 4 GB sandbox exhausted TypeScript
heap in a full project run; this is not a compiler pass. Do not enable a real issuer
or publish the draft connection to production as tested.

### Working checkpoint, 2026-10-27

Branch `ai/chatgpt/mcp-3-oauth-connect` contains the saved acceptance plan, correctly pinned OAuth/MCP SDKs, conditional issuer and read-only scope definitions, initial OAuth metadata/MCP bearer route, generated eight OAuth models and additive `McpConnection` migration, backup exclusions, restore-to-revoked treatment, and draft consent/disconnect screens. Four issuer/scope/redirect tests passed; Prisma schema validation and client generation passed with **synthetic local connection strings**. This is **not shipped** and must not be treated as working OAuth until the SDK end-to-end roundtrip, real disposable database tests, quick checks, screen/accessibility acceptance, and exact-head CI/review are all verified. In particular, registration abuse limits, audit on approval, and token/consent edge cases still require verification and repair.
