import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { GET as manifestGet } from "@/app/api/contract/route";
import { GET as toolSearch } from "@/app/api/tools/route";
import { GET as toolDescribe, POST as toolCall } from "@/app/api/tools/[name]/route";
import { POST as toolBatch } from "@/app/api/tools/_batch/route";
import { GET as rtcWhoami } from "@/app/api/whoami/route";

const context: AgentContext = {
  userId: "synthetic-owner", name: "Synthetic owner", role: "OWNER",
  connectionId: "synthetic-pass-connection", connectionLabel: "Test pass",
  scopes: ["ops:read"],
};
vi.mock("@/domains/agent-control/passes", () => ({
  authenticateRtcPass: vi.fn(async (request: Request) =>
    request.headers.get("authorization") === "Bearer test-fixture"
      ? context : new Response("RTC pass required.", { status: 401 })),
}));

const req = (path: string, method: "GET" | "POST" = "GET", json?: unknown) =>
  new Request("http://localhost" + path, {
    method, headers: { Authorization: "Bearer test-fixture",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
const toolCtx = (name: string) => ({ params: Promise.resolve({ name }) });

describe("MCP-9 RTC read-only HTTP adapter uses the actual MCP catalog", () => {
  it("serves an unauthenticated versioned manifest with real tool counts", async () => {
    const response = await manifestGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rtc).toBe(1);
    expect(body.prefix).toBe("appliance");
    expect(body.counts.tools).toBeGreaterThan(15);
    expect(body.devTools).toBe(false);
  });
  it("requires a pass on the HTTP tool door, never accepting a missing bearer", async () => {
    const denied = await toolSearch(new Request("http://localhost/api/tools"));
    expect(denied.status).toBe(401);
  });
  it("lists and describes the exact MCP read tool with no new authority", async () => {
    const listing = await toolSearch(req("/api/tools?q=whoami&limit=10"));
    expect(listing.status).toBe(200);
    const found = await listing.json();
    expect(found.result.tools.some((item: { name: string }) => item.name === "appliance_whoami")).toBe(true);
    const detail = await toolDescribe(req("/api/tools/appliance_whoami"), toolCtx("appliance_whoami"));
    expect(detail.status).toBe(200);
    expect((await detail.json()).result.writes).toBe(false);
  });
  it("refuses non-read tools even when a caller sends confirm", async () => {
    const denied = await toolCall(req("/api/tools/appliance_action_execute", "POST", { confirm: true }),
      toolCtx("appliance_action_execute"));
    expect(denied.status).toBe(403);
    const deniedAgain = await toolCall(req("/api/tools/appliance_action_execute", "POST", {}),
      toolCtx("appliance_action_execute"));
    expect(deniedAgain.status).toBe(403);
  });
  it("executes only real scoped read handlers via MCP, and batches only reads", async () => {
    const read = await toolCall(req("/api/tools/appliance_whoami", "POST", {}),
      toolCtx("appliance_whoami"));
    expect(read.status).toBe(200);
    expect((await read.json()).result.role).toBe("OWNER");
    const batch = await toolBatch(req("/api/tools/_batch", "POST", { calls: [
      { name: "appliance_whoami", args: {} },
    ] }));
    expect(batch.status).toBe(200);
    expect((await batch.json()).result.results).toHaveLength(1);
    const notAllowed = await toolBatch(req("/api/tools/_batch", "POST", { calls: [
      { name: "appliance_action_preview", args: {} },
    ] }));
    expect(notAllowed.status).toBe(403);
  });
  it("whoami never returns a reusable credential", async () => {
    const response = await rtcWhoami(req("/api/whoami"));
    const body = await response.json();
    expect(body.result.scopes).toEqual(["ops:read"]);
    expect(JSON.stringify(body)).not.toContain("test-fixture");
  });
});
