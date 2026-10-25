# Build spec — Connect an AI assistant, and let it read health (MCP-3, MCP-4)

Cards: `docs/pr-cards/MCP-3.md`, `docs/pr-cards/MCP-4.md`. Design: `docs/mcp/ARCHITECTURE.md`, `CONTRACT.md` (tool names
and the diagnostic shape), `SECURITY.md`. Approved by Chris 2026-10-25. Depends on MCP-1 (the diagnostic fields).
Read `docs/AI-PR-READ-FIRST.md` (auth/session) and the Next.js route-handler guide
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` ("Streaming") before coding.

**What Chris gets:** on System health, "Connect an AI assistant" shows one address to paste into Claude (or another
assistant that supports MCP). The assistant opens a sign-in page on his app; he signs in as usual (password + second
step), sees exactly what it will be allowed to do, and taps Allow. From then on the assistant can read the app's
health, problems, backups and open decisions. He can disconnect it at any time and it stops at once.

Facts checked 2026-10-25:
- Better Auth installed is **1.7.12** with only the `twoFactor` plugin; it has no OAuth-provider plugin built in.
  The separate package `@better-auth/oauth-provider` is published at **1.7.12** (peer `better-auth ^1.7.12`); it adds
  the models `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthAccessToken`, `oauthRefreshToken`,
  `oauthConsent`, `oauthClientAssertion`, and options including `loginPage`, `consentPage`, `scopes`, `resources`,
  `allowDynamicClientRegistration`, `allowUnauthenticatedClientRegistration`, `clientRegistrationRequirePKCE`,
  `clientRegistrationAllowedScopes`, `accessTokenExpiresIn`, `refreshTokenExpiresIn`, `validateRedirectUri`,
  `signup`. Its resource-server helper `oauthProviderResourceClient` (`@better-auth/oauth-provider/client-resource`)
  gives `verifyAccessTokenRequest` and `getProtectedResourceMetadata`. Read its `.d.mts` files for exact option
  types before writing config; the names above are copied from 1.7.12's type file.
- `@modelcontextprotocol/sdk` is not installed. Use **1.32.0** (published 2026-10-02). It exports `McpServer`
  (`server/mcp.js`, use `registerTool`) and `WebStandardStreamableHTTPServerTransport`
  (`server/webStandardStreamableHttp.js`) whose `handleRequest(req: Request, { authInfo })` returns a `Response` —
  the right fit for a Next.js route handler.
- `requireRole` redirects and reads cookies, so it can't guard a bearer-token route; the proxy (`src/proxy.ts`) does
  not match `/api/*`.

## 1. Packages and configuration
- `npm install --save-exact @better-auth/oauth-provider@<same version as better-auth> @modelcontextprotocol/sdk@1.32.0`.
  A test (`tests/mcp-versions.test.ts`) asserts the oauth-provider version equals better-auth's.
- New server env names (documented in `docs/ARCHITECTURE.md`, values never in the repo): `MCP_ISSUER_URL` — the one
  canonical address (production `https://robinsonappliancerentals.com`; testing app its own). When unset, every MCP and
  OAuth route returns 404 and the System health card says "Not available on this copy of the app". The issuer **never**
  comes from the request host or the `allowedHosts` wildcard list in `src/lib/auth.ts`.
- `src/lib/auth.ts`: add the `jwt()` plugin (needed for signed access tokens; `jwks` model) and
  `oauthProvider({ loginPage: "/login", consentPage: "/connect/consent", scopes: MCP_SCOPES,
  resources: [`${issuer}/api/mcp`], allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true,
  clientRegistrationRequirePKCE: true, clientRegistrationAllowedScopes: MCP_SCOPES, accessTokenExpiresIn: 600,
  refreshTokenExpiresIn: 60 * 60 * 24 * 30, signup: false })`, only when `MCP_ISSUER_URL` is set. Unauthenticated
  registration is allowed because assistants register themselves; a registered client can do nothing until the
  owner approves it on the consent page, registration is rate limited (`isRateLimited("oauth-register:" + ip, { max:
  10, windowMs: 3_600_000 })` via the plugin's hook or a wrapper route), and redirect URIs must be `https://` or
  loopback `http://127.0.0.1|localhost:{port}` (custom `validateRedirectUri`). Public sign-up stays disabled.
- Schema: run the Better Auth CLI generator once to get the plugin models, paste them into `prisma/schema.prisma` as an
  **additive** migration `20261028000000_mcp_oauth`, and add the app's own table:
```prisma
model McpConnection {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation("McpConnections", fields: [userId], references: [id], onDelete: Cascade)
  oauthClientId String
  label         String   @db.VarChar(80)     // client name at approval, editable
  scopes        String[]
  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?
  lastToolName  String?  @db.VarChar(80)
  revokedAt     DateTime?
  revokedReason String?  @db.VarChar(200)
  @@unique([userId, oauthClientId])
  @@index([userId, revokedAt])
}
```
- Backups: every OAuth table and `jwks` → `null` in `BACKUP_MODEL_POLICY` (secrets never in backups). `McpConnection`
  → backed up, and `scripts/restore-backup.ts` sets `revokedAt = now, revokedReason = "Restored from backup — connect
  again"` on every restored row (test).

## 2. Scopes (`src/mcp/scopes.ts`)
```ts
export const MCP_SCOPES = ["ops:read", "decisions:read"] as const;   // MCP-5 adds "ops:maintain", "decisions:apply"; MCP-11 adds "feedback:triage"
export const SCOPE_WORDS = {
  "ops:read": "See whether the app's jobs, backups and settings are working, and the problems it found",
  "decisions:read": "See your open business and tax questions and their starting values",
};
```
Only OWNER and ADMIN may connect in this unit (SECURITY.md line 11). A STAFF or CUSTOMER who reaches the consent page
sees "Only the owner or an admin can connect an assistant." and no Allow button.

## 3. Sign-in and consent
- `/login` already exists; the plugin returns there with its query. After sign-in (including the second step),
  Better Auth continues to the consent page.
- `src/app/connect/consent/page.tsx` (server component; `requireRole("OWNER","ADMIN")` — this is a browser page, so it
  works): shows the assistant's name (client name from the plugin; if missing "An unnamed assistant"), the address it
  will return to (host only), the scope words as a list, and "It will act as you ({name}). It can't see bank or card
  numbers or change anything." Buttons **Allow** and **Don't allow**. Allow calls the plugin's consent endpoint
  (server action) and, in the same request, upserts `McpConnection { userId, oauthClientId, label, scopes,
  revokedAt: null }`. Audit `mcp.connection_approved`.
- Words pass the plain-words check; page follows the kit (works without JavaScript except the buttons' form posts).

## 4. Every request to `/api/mcp` (`src/domains/agent-control/authorization.ts`)
```ts
export async function authenticateMcpRequest(req: Request): Promise<AgentContext | Response>
```
1. `MCP_ISSUER_URL` unset → 404. No `Authorization: Bearer` → 401 with `WWW-Authenticate: Bearer
   resource_metadata="{issuer}/.well-known/oauth-protected-resource/api/mcp"`.
2. `verifyAccessTokenRequest` (audience `${issuer}/api/mcp`, issuer `${issuer}/api/auth`, JWKS from the app's own
   `/api/auth/jwks`) → claims `sub` (user id), `azp`/`client_id`, `scope`. Failure → 401 (same header).
3. Load `McpConnection` by `(sub, client_id)`; missing or `revokedAt` set → 401 "This assistant was disconnected".
   This is what makes disconnecting instant even though a signed token lives up to 10 minutes.
4. Re-read the user: not archived, role OWNER/ADMIN, second step enrolled (`twoFactorEnrollmentRequired` false) —
   else revoke the connection with reason "Role changed" and 403. Role is never taken from the token.
5. Rate limit `isRateLimited("mcp:" + connectionId, { max: 120, windowMs: 600_000 })` → 429 with `Retry-After`.
6. Update `lastUsedAt` at most once per minute (conditional update).
Return `AgentContext` (CONTRACT.md) with `scopes` = token scopes ∩ connection scopes.

Metadata routes:
- `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts` → `getProtectedResourceMetadata({ resource:
  `${issuer}/api/mcp`, authorization_servers: [`${issuer}/api/auth`] })`.
- `src/app/.well-known/oauth-authorization-server/api/auth/route.ts` → the plugin's
  `oauthProviderAuthServerMetadata` helper (exported from the package).
Both 404 when unset; both cache 1 hour.

## 5. The MCP route (`src/app/api/mcp/route.ts`, Node runtime)
```ts
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  const ctx = await authenticateMcpRequest(req);
  if (ctx instanceof Response) return ctx;
  const server = buildMcpServer(ctx);                       // src/mcp/server.ts — new server per request
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req, { authInfo: { token: "", clientId: ctx.connectionId, scopes: [...ctx.scopes] } });
}
export { handle as GET, handle as POST, handle as DELETE };
```
Stateless (no session ids): every call authenticates again. OPTIONS → 204 with no CORS allowance for browsers
(assistants call server-to-server). Body limit 1 MB (check `content-length`, else read with a cap).

## 6. Tools in this unit (`src/mcp/tools/*.ts`, one registry `src/mcp/catalog.ts`)
Each tool: name, title, description, zod input schema (unknown fields rejected), output schema, required scope,
`annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`, and a
handler that receives `AgentContext`. The registry is the only place `buildMcpServer` reads; a test asserts every
registered tool has a scope and that its handler calls the domain read functions that do their own role check
(MCP-1/DEC-1 functions take an explicit actor id; add `asActor(ctx)` overloads where they only use the session).
| Tool | Returns | Scope |
|---|---|---|
| `appliance_whoami` | name, role, scopes, connection label, environment (`production` / `testing`), app revision | any |
| `appliance_health_get_overview` | counts by `HealthState`, each job's state/explanation/next step/last success/next due (Denver and UTC) | ops:read |
| `appliance_health_list_issues` | open system issues as `DiagnosticFact` (CONTRACT.md), cursor, limit ≤ 100 | ops:read |
| `appliance_health_get_issue` | one issue + its recent runs (codes, stages, references) | ops:read |
| `appliance_automation_list_runs` | one job's last ≤ 50 runs, codes only | ops:read |
| `appliance_configuration_get_readiness` | each integration's missing env **names**, private store readiness word, never values | ops:read |
| `appliance_backup_get_status` | newest verified backup time, photo copy counts, retention attention, store kind | ops:read |
| `appliance_decisions_list` | DEC-1 `listDecisions` cards (title, question, current value words, state, sources) | decisions:read |
| `appliance_decisions_get` | DEC-1 `getDecision` with history | decisions:read |
Outputs never include customer names, emails, phones, addresses, report text or storage paths. Each output is also
returned as text (JSON) for clients without structured output. Results over 8 KB are cut to the first page with a
`nextCursor`; no result handles yet (MCP-5).

## 7. Owner screens
System health page, new card **AI assistants**:
- Not set up (`MCP_ISSUER_URL` unset): "Not available on this copy of the app."
- Set up: "Connect an AI assistant" → Sheet with the address `{issuer}/api/mcp` (copy button), three plain steps for
  Claude ("Settings › Connectors › Add custom connector, paste this address, then sign in here and tap Allow"), and
  "Only you and admins can connect one."
- List of connections (own; the OWNER sees all): label, who approved it, what it can do (scope words), "Last used
  {relativeTime}", **Disconnect** (ConfirmDialog "Disconnect {label}? It stops working right away.") →
  `revokeMcpConnection(actorId, id)`: lock row, OWNER or the connection's own ADMIN user, set `revokedAt`, revoke the
  plugin's refresh tokens and consent for that client and user (plugin API), audit `mcp.connection_revoked`.
- The legacy key panel stays, retitled "Old check-up key" with "Reads reported problems and adds notes. New
  assistants should use Connect an AI assistant instead."

## 8. Tests
- `tests/mcp-oauth-security.test.ts`: issuer never from Host header; redirect URI rules; PKCE required; wrong
  audience, expired, other issuer, tampered token → 401; registration rate limit.
- `tests/mcp-auth-integration.test.ts` (throwaway Postgres; local issuer `http://localhost:3000`): a real SDK client
  (`@modelcontextprotocol/sdk/client`) runs authorize → consent (helper signs in a seeded owner session) → token →
  `tools/list` → `appliance_whoami`; refresh works; Disconnect → next call 401 within the same token's lifetime; role
  downgrade to STAFF → 403 and connection revoked; archived user → 401; staff at consent page sees no Allow; customer
  login/password reset still pass (existing suites run unchanged).
- `tests/mcp-dispatch.test.ts`: every tool's schema rejects unknown fields; scope missing → tool error code
  `FORBIDDEN_SCOPE`; outputs pass a PII canary (seed a customer with a unique name/email/phone; none appear in any tool
  output).
- `tests/mcp-transport-integration.test.ts`: two concurrent clients with different users get only their own whoami;
  1 MB body limit; DELETE/GET handled; restored connections are revoked.
- `e2e/mcp-connections.spec.ts` (shard): owner opens the card, copies the address, approves a test client on the
  consent page (test client registered by the test via the registration endpoint), sees it listed, disconnects it.
  Axe, phone/desktop, light/dark, keyboard.

## 9. Owner checklist row (once)
"Connect Claude to Appliance Desk": after the nightly release includes MCP-4, set `MCP_ISSUER_URL` on the live app
(steps in Vercel), then in Claude add the custom connector with the address shown on System health, sign in, Allow,
and ask "What's the health of my app?". Ready when the card shows the address; it worked when the connection shows
"Last used just now". This row never blocks merging.
