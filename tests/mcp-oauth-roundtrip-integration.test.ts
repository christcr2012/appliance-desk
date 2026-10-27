import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ cookie: "", userId: "" }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ sent: false, outcome: "NOT_ATTEMPTED" })) }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: vi.fn(async () => false) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: session.cookie }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireRole: async (...allowed: string[]) => {
    if (!allowed.includes("OWNER")) throw new Error("Only owners may approve");
    return { user: { id: session.userId, name: "Test owner", role: "OWNER" } };
  },
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("TEST_OAUTH_REDIRECT:" + url); } }));

import { prisma } from "@/lib/prisma";
import { createTrustedCredentialUserInTx } from "@/lib/account-provisioning";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP OAuth local loopback client on disposable PostgreSQL", () => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = "mcp-flow-" + key + "@example.test";
  const password = "temporary-test-password-" + key;
  const redirectUri = "http://127.0.0.1:43199/callback";
  const previousIssuer = process.env.MCP_ISSUER_URL;
  const previousAuth = process.env.BETTER_AUTH_URL;
  let origin = "";
  let server: Server;
  let auth: (typeof import("@/lib/auth"))["auth"];
  let clientId = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      void (async () => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const request = new Request(origin + (req.url ?? "/"), {
            method: req.method ?? "GET", headers,
            ...(["POST", "PUT", "PATCH"].includes(req.method ?? "") ? { body: Buffer.concat(chunks) } : {}),
          });
          const response = (req.url ?? "").startsWith("/api/auth/oauth2/authorize")
            ? await (await import("@/app/api/auth/oauth2/authorize/route")).GET(request)
            : (req.url ?? "").startsWith("/api/mcp")
              ? await (await import("@/app/api/mcp/route")).POST(request)
              : await auth.handler(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          res.writeHead(500);
          res.end(error instanceof Error ? error.message : "server error");
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const bound = server.address();
    if (!bound || typeof bound === "string") throw new Error("Missing local port");
    origin = "http://127.0.0.1:" + bound.port;
    process.env.MCP_ISSUER_URL = origin;
    process.env.BETTER_AUTH_URL = origin;
    vi.resetModules();
    auth = (await import("@/lib/auth")).auth;
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toContain("oauth-provider");
    const actor = await prisma.$transaction((tx) => createTrustedCredentialUserInTx(tx, {
      email, name: "Test owner", role: "OWNER", password,
    }));
    session.userId = actor.id;
  });

  afterAll(async () => {
    if (clientId) {
      await prisma.mcpConnection.deleteMany({ where: { oauthClientId: clientId } });
      await prisma.oauthClient.deleteMany({ where: { clientId } });
    }
    if (session.userId) {
      await prisma.auditLog.deleteMany({ where: { userId: session.userId } });
      await prisma.user.deleteMany({ where: { id: session.userId } });
    }
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (previousIssuer === undefined) delete process.env.MCP_ISSUER_URL;
    else process.env.MCP_ISSUER_URL = previousIssuer;
    if (previousAuth === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousAuth;
  });

  it("publicly registers a limited PKCE client and reaches explicit owner consent", async () => {
    const registration = await fetch(origin + "/api/auth/oauth2/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test client", redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        token_endpoint_auth_method: "none", application_type: "native", scope: "ops:read offline_access",
      }),
    });
    expect(registration.status, await registration.clone().text()).toBeLessThan(300);
    const client = await registration.json() as { client_id: string };
    clientId = client.client_id;
    expect(clientId).toBeTruthy();

    const signedIn = await auth.api.signInEmail({
      body: { email, password }, returnHeaders: true,
    }) as unknown as { headers: Headers };
    session.cookie = signedIn.headers.getSetCookie()
      .map((part) => part.split(";")[0]).filter(Boolean).join("; ");
    expect(session.cookie).toContain("session_token");

    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const query = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri,
      scope: "ops:read offline_access", resource: origin + "/api/mcp", state: "test-state-" + key,
      code_challenge: codeChallenge, code_challenge_method: "S256",
    });
    const authorization = await fetch(origin + "/api/auth/oauth2/authorize?" + query.toString(), {
      redirect: "manual", headers: { Cookie: session.cookie, Accept: "text/html" },
    });
    expect([302, 303, 307, 308], await authorization.clone().text()).toContain(authorization.status);
    const consentUri = new URL(authorization.headers.get("location") ?? "", origin);
    expect(consentUri.pathname, `OAuth error code: ${consentUri.searchParams.get("error") ?? "none"}`).toBe("/connect/consent");
    const { respondToAssistantConsent } = await import("@/app/connect/consent/actions");
    const consent = new FormData();
    consent.set("oauthQuery", consentUri.searchParams.toString());
    consent.set("decision", "allow");
    let returned = "";
    try { await respondToAssistantConsent(consent); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("TEST_OAUTH_REDIRECT:")) returned = message.slice("TEST_OAUTH_REDIRECT:".length);
      else throw error;
    }
    expect(returned).toContain(redirectUri);
    const code = new URL(returned).searchParams.get("code");
    expect(code).toBeTruthy();
    const connection = await prisma.mcpConnection.findFirstOrThrow({
      where: { userId: session.userId, oauthClientId: clientId },
    });
    expect(connection.revokedAt).toBeNull();

    const tokenResponse = await fetch(origin + "/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: code!, redirect_uri: redirectUri,
        client_id: clientId, code_verifier: codeVerifier,
      }).toString(),
    });
    expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
    const granted = await tokenResponse.json() as {
      access_token: string; refresh_token?: string; token_type: string;
    };
    expect(granted.access_token).toBeTruthy();
    expect(granted.refresh_token).toBeTruthy();
    const refreshResponse = await fetch(origin + "/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: granted.refresh_token!, client_id: clientId,
      }).toString(),
    });
    expect(refreshResponse.status, await refreshResponse.clone().text()).toBe(200);
    const renewed = await refreshResponse.json() as { access_token: string; refresh_token?: string };
    expect(renewed.access_token).toBeTruthy();

    const { decodeJwt } = await import("jose");
    const signedClaims = decodeJwt(renewed.access_token);
    expect(signedClaims).toEqual(expect.objectContaining({ sub: expect.any(String), aud: expect.anything() }));
    const { oauthProviderResourceClient } = await import("@better-auth/oauth-provider/resource-client");
    const verified = await oauthProviderResourceClient().getActions().verifyAccessTokenRequest(
      new Request(origin + "/api/mcp", { method: "POST", headers: { Authorization: "Bearer " + renewed.access_token } }),
      { jwksUrl: origin + "/api/auth/jwks", verifyOptions: { audience: origin + "/api/mcp", issuer: origin + "/api/auth" } },
    );
    expect(verified.sub).toBe(session.userId);

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const sdkClient = new Client({ name: "appliance-desk-local", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), {
      requestInit: { headers: { Authorization: "Bearer " + renewed.access_token } },
    });
    try {
      await sdkClient.connect(transport);
      const whoami = await sdkClient.callTool({ name: "appliance_whoami", arguments: {} });
      expect(whoami.isError).not.toBe(true);
      expect(JSON.stringify(whoami)).toContain("ops:read");

      const { disconnectAssistant } = await import("@/app/desk/automations/assistant-actions");
      const data = new FormData();
      data.set("id", connection.id);
      await disconnectAssistant(data);
      expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connection.id } })).revokedAt).not.toBeNull();
      const refused = await fetch(origin + "/api/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer " + renewed.access_token,
          Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: {}, id: 15 }),
      });
      expect(refused.status).toBe(401);
    } finally {
      await sdkClient.close();
    }


  }, 45_000);
});
