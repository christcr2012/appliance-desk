import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { runConformance } from "./fixtures/rtc-upstream/src/run.js";
import { GET as contractGet } from "@/app/api/contract/route";
import { GET as openapiGet } from "@/app/api/openapi.json/route";
import { GET as listGet } from "@/app/api/tools/route";
import { GET as describeGet, POST as toolPost } from "@/app/api/tools/[name]/route";
import { POST as batchPost } from "@/app/api/tools/_batch/route";
import { GET as whoGet } from "@/app/api/whoami/route";
import { GET as resultGet } from "@/app/api/results/[handle]/route";

const fakes = vi.hoisted(() => ({
  issues: vi.fn(),
  saved: new Map<string, { userId: string; connectionId: string; payload: unknown }>(),
  handles: 0,
}));
const base: AgentContext = {
  userId: "synthetic-rtc-owner", name: "Synthetic Owner", role: "OWNER",
  connectionId: "synthetic-full", connectionLabel: "Synthetic full pass",
  scopes: ["ops:read", "ops:maintain"], rtcAllowWrites: true,
};
const errorBody = (code: string) => ({
  ok: false, error: { code, what: "Pass is unavailable",
    cause: "Synthetic credential denied", todo: "Check the test fixture", technical: "" },
});
vi.mock("@/domains/agent-control/passes", () => ({
  authenticateRtcPass: vi.fn(async (request: Request) => {
    const credential = request.headers.get("authorization");
    if (credential === "Bearer synthetic-full") return base;
    if (credential === "Bearer synthetic-readonly")
      return { ...base, connectionId: "synthetic-readonly", rtcAllowWrites: false,
        scopes: ["ops:read"] };
    const code = credential === "Bearer synthetic-expired" ? "pass_expired" :
      credential === "Bearer synthetic-revoked" ? "pass_revoked" : "permission";
    return Response.json(errorBody(code), { status: 401 });
  }),
}));
vi.mock("@/mcp/tools/diagnostics", async importOriginal => {
  const original = await importOriginal<typeof import("@/mcp/tools/diagnostics")>();
  return { ...original, checkMcpActor: vi.fn(async () => undefined),
    issuesList: fakes.issues };
});
vi.mock("@/domains/agent-control/rtc-results", async importOriginal => {
  const original = await importOriginal<typeof import("@/domains/agent-control/rtc-results")>();
  return {
    ...original,
    storeRtcResult: async (ctx: AgentContext, payload: unknown) => {
      const handle = "rtc_result_" + String(++fakes.handles).padStart(43, "0");
      fakes.saved.set(handle, { userId: ctx.userId,
        connectionId: ctx.connectionId, payload });
      return handle;
    },
    readRtcResult: async (ctx: AgentContext, handle: string) => {
      const entry = fakes.saved.get(handle);
      if (!entry || entry.connectionId !== ctx.connectionId ||
          entry.userId !== ctx.userId) throw new Error("RTC_RESULT_NOT_FOUND");
      return entry.payload;
    },
  };
});
const issue = (id: string, explanation: string) => ({
  id, kind: "SYSTEM", severity: "INFO", status: "OPEN",
  count: 1, firstSeenUtc: null, lastSeenUtc: null,
  failure: { code: "SYNTHETIC", stage: null, reference: null,
    explanation, nextStep: "Synthetic test evidence only" },
});
let closeCurrent: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeCurrent?.(); closeCurrent = undefined;
  fakes.saved.clear(); fakes.issues.mockReset(); fakes.handles = 0;
});

/** Calls the real app route handlers over HTTP without a deployment, real pass or production DB. */
async function fixtureAppServer() {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? "/", "http://localhost");
      const method = incoming.method ?? "GET";
      const bytes: Uint8Array[] = [];
      for await (const piece of incoming) bytes.push(piece as Uint8Array);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const input = new Request("http://localhost" + url.pathname + url.search, {
        method, headers,
        ...(method === "POST" ? { body: Buffer.concat(bytes).toString("utf8") } : {}),
      });
      let response: Response;
      if (url.pathname === "/api/contract" && method === "GET") response = await contractGet();
      else if (url.pathname === "/api/openapi.json" && method === "GET") response = await openapiGet();
      else if (url.pathname === "/api/whoami" && method === "GET") response = await whoGet(input);
      else if (url.pathname === "/api/tools" && method === "GET") response = await listGet(input);
      else if (url.pathname === "/api/tools/_batch" && method === "POST") response = await batchPost(input);
      else if (url.pathname.startsWith("/api/results/") && method === "GET") {
        response = await resultGet(input, { params: Promise.resolve({
          handle: decodeURIComponent(url.pathname.slice("/api/results/".length)),
        }) });
      } else if (url.pathname.startsWith("/api/tools/")) {
        const context = { params: Promise.resolve({
          name: decodeURIComponent(url.pathname.slice("/api/tools/".length)),
        }) };
        response = method === "GET" ? await describeGet(input, context) :
          method === "POST" ? await toolPost(input, context) :
            Response.json(errorBody("not_found"), { status: 404 });
      } else response = Response.json(errorBody("not_found"), { status: 404 });
      const responseHeaders = Object.fromEntries(response.headers.entries());
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify(errorBody("service_error")));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_HTTP_TEST_PORT");
  closeCurrent = async () => { server.closeAllConnections(); await new Promise<void>(
    (resolve, reject) => server.close(err => err ? reject(err) : resolve())); };
  return "http://127.0.0.1:" + address.port;
}

describe("Pinned RTC 1 probes against actual Appliance Desk HTTP route handlers", () => {
  it("records the exact conformance gaps without claiming app certification", async () => {
    const first = "c" + "a".repeat(20);
    const second = "c" + "b".repeat(20);
    fakes.issues.mockImplementation(async (_ctx: unknown, args: { cursor?: string }) =>
      args.cursor === first ? { issues: [issue(second, "B".repeat(5400))],
        nextCursor: null } : { issues: [issue(first, "A".repeat(5400))],
        nextCursor: first });
    const url = await fixtureAppServer();
    const report = await runConformance({
      url,
      passes: {
        full: "synthetic-full", readOnly: "synthetic-readonly",
        expired: "synthetic-expired", revoked: "synthetic-revoked",
      },
      fixtures: {
        read: { name: "appliance_whoami", args: {} },
        write: { name: "appliance_action_preview", args: {
          action: "PAUSE_AUTOMATION", args: { ruleKey: "synthetic-rule" },
          requestKey: "synthetic-request-001",
        } },
        guarded: { name: "appliance_action_execute", args: {
          previewId: "synthetic-preview-001", requestKey: "synthetic-request-001",
        } },
        largeRead: { name: "appliance_health_list_issues", args: {} },
        field: "role", valueArgument: "value",
      },
    });
    const byName = new Map(report.checks.map(row => [row.name, row]));
    for (const name of ["manifest", "manifest.openapi", "catalog", "meta",
      "reads", "passes", "passes.read_only", "passes.expired",
      "passes.revoked", "safety", "budget"]) {
      expect(byName.get(name), name).toMatchObject({ ok: true });
    }
    // Pinned reference writes require a generic direct state setter. Appliance Desk
    // uses a two-stage owner approval journal instead, and must not fake its evidence.
    expect(byName.get("writes")?.ok).toBe(false);
    expect(byName.get("oauth.refresh_settings")?.skipped).toBe(true);
    expect(byName.get("limits.two_instance")?.skipped).toBe(true);
    expect(report.ok).toBe(false);
    expect(fakes.saved.size).toBeGreaterThan(0);
  }, 30_000);
});
