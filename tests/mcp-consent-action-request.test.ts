import { beforeAll, describe, expect, it, vi } from "vitest";

// Regression test for the hosted consent failure (MCP-9 trial, 2026-11-02):
// the consent action calls the OAuth provider through auth.handler with a
// hand-built Request. In production the provider's CSRF origin check runs on
// every POST and refuses a cookie-bearing request that carries no Origin or
// Referer header (403 MISSING_OR_NULL_ORIGIN) before the consent handler
// runs, so Allow always landed on the app's error page. The check is skipped
// under NODE_ENV=test (Better Auth's isTest default), so the loopback
// round-trip suite cannot see it; this test pins the request shape instead:
// the server-to-self call must carry the app's own issuer as its Origin.

const ISSUER = "https://testing.example.test";
const state = vi.hoisted(() => ({
  handlerCalls: [] as Request[],
  createdConnections: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session_token=test-session" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("TEST_REDIRECT:" + url); },
}));
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ user: { id: "owner-1", role: "OWNER" } }),
}));
vi.mock("@/lib/team-actor", () => ({ assertActiveTeamActor: async () => {} }));
vi.mock("@/lib/auth", () => ({
  auth: {
    handler: async (request: Request) => {
      state.handlerCalls.push(request);
      return new Response(JSON.stringify({ url: "https://example.com/callback?code=test-code" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  },
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: async () => [],
    mcpConnection: {
      findUnique: async () => null,
      create: async (args: unknown) => { state.createdConnections.push(args); return {}; },
      update: async () => ({}),
    },
  };
  return {
    prisma: {
      oauthClient: { findFirst: async () => ({ clientId: "client-1", name: "Trial client" }) },
      mcpConnection: { findUnique: async () => null },
      $transaction: async (fn: (txArg: typeof tx) => unknown) => fn(tx),
    },
  };
});

let respondToAssistantConsent: (typeof import("@/app/connect/consent/actions"))["respondToAssistantConsent"];

beforeAll(async () => {
  process.env.MCP_ISSUER_URL = ISSUER;
  ({ respondToAssistantConsent } = await import("@/app/connect/consent/actions"));
});

describe("assistant consent action's provider request", () => {
  it("carries the app's own Origin so the production origin check lets it through", async () => {
    const form = new FormData();
    form.set("oauthQuery", "client_id=client-1&scope=ops%3Aread");
    form.set("decision", "allow");
    let redirected = "";
    try { await respondToAssistantConsent(form); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("TEST_REDIRECT:")) redirected = message.slice("TEST_REDIRECT:".length);
      else throw error;
    }
    expect(redirected).toBe("https://example.com/callback?code=test-code");
    expect(state.handlerCalls).toHaveLength(1);
    const request = state.handlerCalls[0]!;
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/auth/oauth2/consent");
    // The pinned regression: without this header the provider answers
    // 403 MISSING_OR_NULL_ORIGIN in production and no connection is recorded.
    expect(request.headers.get("origin")).toBe(ISSUER);
    expect(request.headers.get("cookie")).toContain("session_token=test-session");
    const body = JSON.parse(await request.text()) as { accept: boolean; oauth_query: string };
    expect(body.accept).toBe(true);
    expect(body.oauth_query).toContain("client_id=client-1");
    expect(state.createdConnections).toHaveLength(1);
  });
});
