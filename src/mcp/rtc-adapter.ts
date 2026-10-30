import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/mcp/server";
import { authenticateRtcPass } from "@/domains/agent-control/passes";
import { storeRtcResult, readRtcResult } from "@/domains/agent-control/rtc-results";
import type { AgentContext } from "@/domains/agent-control/authorization";

type ClientTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type Authorized = { ctx: AgentContext } | { response: Response };
const flags = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export const rtcJson = (payload: object, status = 200) =>
  Response.json(payload, { status, headers: flags });
export const rtcError = (code: string, status = 400) => rtcJson({
  ok: false, error: { code, what: code, cause: "Request not accepted",
    todo: "Check the granted pass and supported request", technical: null },
}, status);

export async function rtcAuthorized(req: Request): Promise<Authorized> {
  const ctx = await authenticateRtcPass(req);
  return ctx instanceof Response ? { response: ctx } : { ctx };
}

/** RTC invokes the actual MCP registry through the official in-memory SDK. */
async function mcpRead<T>(ctx: AgentContext, fn: (client: Client) => Promise<T>): Promise<T> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(ctx);
  const client = new Client({ name: "appliance-desk-rtc", version: "1.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await fn(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
const publicTool = (tool: ClientTool) => ({
  name: tool.name, description: tool.description ?? "",
  inputSchema: tool.inputSchema, annotations: tool.annotations ?? {},
  area: tool.name.replace(/^appliance_/, "").split("_")[0],
  profiles: ["read_only"], audience: ["owner", "operator"],
  writes: false, money: false, destructive: false,
});

export async function rtcTools(ctx: AgentContext) {
  return mcpRead(ctx, async client => {
    const result = await client.listTools();
    return result.tools.filter(tool => tool.annotations?.readOnlyHint === true);
  });
}

export async function rtcToolList(ctx: AgentContext, query = "", limit = 10) {
  const needle = query.toLowerCase().trim().slice(0, 200);
  const tools = await rtcTools(ctx);
  return tools.filter(tool => !needle || tool.name.includes(needle) ||
    (tool.description ?? "").toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(limit, 20))).map(publicTool);
}

export async function rtcToolDescribe(ctx: AgentContext, name: string) {
  const tool = (await rtcTools(ctx)).find(item => item.name === name);
  return tool ? publicTool(tool) : null;
}

export async function rtcToolCall(ctx: AgentContext, name: string,
  args: Record<string, unknown> = {}) {
  const tool = (await rtcTools(ctx)).find(item => item.name === name);
  if (!tool) throw new Error("outside_scope");
  const result = await mcpRead(ctx, client => client.callTool({ name, arguments: args }));
  if (result.isError) throw new Error("refused_by_guard");
  const payload = result.structuredContent ?? { content: result.content };
  const serialized = JSON.stringify(payload);
  if (serialized.length <= 8192) return { ok: true, result: payload };
  // Keep the raw sanitized MCP output owned by this pass; never cut mid-JSON.
  const handle = await storeRtcResult(ctx, payload as Record<string, unknown>);
  return { ok: true, result: { summary: "Result saved for 24 hours", count: 1 },
    handle };
}

export async function rtcResultRead(ctx: AgentContext, handle: string) {
  return { ok: true, result: await readRtcResult(ctx, handle) };
}

export async function rtcManifest() {
  const dummy: AgentContext = { userId: "contract", name: "RTC contract",
    role: "OWNER", connectionId: "contract", connectionLabel: "contract", scopes: [] };
  const result = await mcpRead(dummy, client => client.listTools());
  return {
    rtc: 1, server: "Appliance Desk", prefix: "appliance", version: "1.0.0",
    apiVersion: "1", areas: ["health", "automation", "decisions", "configuration",
      "backup", "feedback", "repair", "optimization"],
    counts: { tools: result.tools.length,
      writes: result.tools.filter(tool => tool.annotations?.readOnlyHint !== true).length,
      money: 0 },
    profiles: ["read_only"], listingModes: ["catalog", "compact"],
    modes: ["test", "production"], devTools: false,
  };
}
