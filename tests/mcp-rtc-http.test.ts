import { describe, expect, it, vi } from "vitest";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { GET as manifestGet } from "@/app/api/contract/route";
import { rtcToolList } from "@/mcp/rtc-adapter";
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
  it("supports paged, scoped catalog and compact listings without exposing writer tools", async () => {
    const catalog = await toolSearch(req("/api/tools?listing=catalog&limit=100&page=1"));
    expect(catalog.status).toBe(200);
    const all = (await catalog.json()).result;
    expect(all.tools.length).toBeGreaterThan(10);
    expect(all.next).toBeNull();
    expect(all.tools.every((tool: { writes: boolean }) => !tool.writes)).toBe(true);
    const first = (await (await toolSearch(req("/api/tools?limit=3&page=1"))).json()).result;
    const second = (await (await toolSearch(req("/api/tools?limit=3&page=2"))).json()).result;
    expect(first.tools).toHaveLength(3);
    expect(first.next).toBe("2");
    expect(second.tools[0].name).not.toBe(first.tools[0].name);
    const compact = (await (await toolSearch(req("/api/tools?listing=compact&limit=100"))).json()).result;
    expect(compact.tools.length).toBeLessThanOrEqual(4);
    expect(compact.tools.some((tool: { name: string }) => tool.name === "appliance_whoami")).toBe(true);
    const health = (await (await toolSearch(req("/api/tools?area=health&limit=100"))).json()).result;
    expect(health.tools.every((tool: { area: string }) => tool.area === "health")).toBe(true);
    expect((await toolSearch(req("/api/tools?limit=101"))).status).toBe(400);
  });
  it("fields and detail select sanitized read output without changing domain schemas", async () => {
    const response = await toolCall(req("/api/tools/appliance_whoami", "POST", {
      detail: "full", fields: "role",
    }), toolCtx("appliance_whoami"));
    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual({ role: "OWNER" });
    const denied = await toolCall(req("/api/tools/appliance_whoami", "POST", {
      fields: "constructor",
    }), toolCtx("appliance_whoami"));
    expect(denied.status).toBe(400);
  });
  it("an area-restricted pass cannot enumerate tools from another area", async () => {
    const healthOnly = await rtcToolList({ ...context, rtcAreas: ["health"] }, "", 100);
    expect(healthOnly.length).toBeGreaterThan(0);
    expect(healthOnly.every(tool => tool.area === "health")).toBe(true);
    expect(healthOnly.some(tool => tool.name === "appliance_whoami")).toBe(false);
  });
  it("tool catalog never advertises read tools outside the pass scope", async () => {
    const feedback = await rtcToolList({ ...context, scopes: ["feedback:triage"] }, "", 100);
    expect(feedback.some(tool => tool.name === "appliance_feedback_list_reports")).toBe(true);
    expect(feedback.some(tool => tool.name === "appliance_health_list_issues")).toBe(false);
    const decisions = await rtcToolList({ ...context, scopes: ["decisions:read"] }, "", 100);
    expect(decisions.some(tool => tool.name === "appliance_decisions_list")).toBe(true);
    expect(decisions.some(tool => tool.name === "appliance_feedback_list_reports")).toBe(false);
  });
  it("whoami never returns a reusable credential", async () => {
    const response = await rtcWhoami(req("/api/whoami"));
    const body = await response.json();
    expect(body.result.scopes).toEqual(["ops:read"]);
    expect(JSON.stringify(body)).not.toContain("test-fixture");
  });
});
