import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/mcp/server";
import { authenticateRtcPass } from "@/domains/agent-control/passes";
import { storeRtcResult, readRtcResult } from "@/domains/agent-control/rtc-results";
import { parseRtcReadInput, projectRtcRead } from "./rtc-projection";
import { rtcCanDiscoverRead } from "./rtc-read-scopes";
import { RTC_JOURNALED_WRITES, rtcWriteDecision } from "./rtc-write-policy";
import type { AgentContext } from "@/domains/agent-control/authorization";

type ClientTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type Authorized = { ctx: AgentContext } | { response: Response };
const flags = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export const rtcJson = (payload: object, status = 200) =>
  Response.json(payload, { status, headers: flags });
export const rtcError = (code: string, status = 400) => rtcJson({
  ok: false, error: { code, what: code, cause: "Request not accepted",
    todo: "Check the granted pass and supported request", technical: "" },
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
function rtcArea(name: string) {
  if (name.startsWith("appliance_action_") || name === "appliance_operation_get")
    return "automation";
  if (name === "appliance_where_is_setting") return "configuration";
  return name.replace(/^appliance_/, "").split("_")[0];
}
const publicTool = (tool: ClientTool) => {
  const writes = tool.annotations?.readOnlyHint !== true;
  const destructive = tool.annotations?.destructiveHint === true;
  return {
    name: tool.name, description: (tool.description ?? "").slice(0, 160),
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: !writes, destructiveHint: destructive,
      idempotentHint: tool.annotations?.idempotentHint === true,
      openWorldHint: tool.annotations?.openWorldHint === true,
    },
    area: rtcArea(tool.name),
    profiles: writes ? ["full"] : ["read_only", "full"],
    audience: ["owner", "operator"], writes, money: false, destructive,
  };
};

export async function rtcTools(ctx: AgentContext) {
  return mcpRead(ctx, async client => {
    const result = await client.listTools();
    return result.tools.filter(tool => {
      const read = tool.annotations?.readOnlyHint === true &&
        rtcCanDiscoverRead(ctx, tool.name);
      const journalWrite = ctx.rtcAllowWrites === true && ctx.scopes.includes("ops:maintain") &&
        RTC_JOURNALED_WRITES.includes(tool.name as (typeof RTC_JOURNALED_WRITES)[number]);
      return (read || journalWrite) &&
        (!ctx.rtcAreas?.length || ctx.rtcAreas.includes(rtcArea(tool.name)));
    });
  });
}

export async function rtcToolList(ctx: AgentContext, query = "", limit = 10) {
  const needle = query.toLowerCase().trim().slice(0, 200);
  const tools = await rtcTools(ctx);
  return tools.filter(tool => !needle || tool.name.includes(needle) ||
    (tool.description ?? "").toLowerCase().includes(needle))
    .slice(0, Math.max(1, Math.min(limit, 100))).map(publicTool);
}

export async function rtcToolDescribe(ctx: AgentContext, name: string) {
  const tool = (await rtcTools(ctx)).find(item => item.name === name);
  return tool ? publicTool(tool) : null;
}

export async function rtcToolCall(ctx: AgentContext, name: string,
  args: Record<string, unknown> = {}) {
  const tool = (await rtcTools(ctx)).find(item => item.name === name);
  if (!tool) throw new Error("outside_scope");
  if (tool.annotations?.readOnlyHint !== true) {
    const decision = rtcWriteDecision(name, args, ctx.rtcAllowWrites === true);
    if (!decision.call) return { ok: true, result: decision.result };
    // This is the *existing* MCP-5 journal handler, including owner approval,
    // immutable preview hash, revocation fences, idempotence and readback.
    const write = await mcpRead(ctx, client => client.callTool({
      name, arguments: decision.domainArgs,
    }));
    if (write.isError) throw new Error("refused_by_guard");
    const payload: Record<string, unknown> =
      write.structuredContent ?? { content: write.content };
    if (name === "appliance_action_preview") {
      if (typeof payload.previewId !== "string") throw new Error("refused_by_guard");
      return { ok: true, result: {
        done: false, needsConfirmation: true,
        summary: payload.summary ?? "Preview recorded; separate owner approval is required",
        previewId: payload.previewId, state: payload.state,
        logged: { id: payload.previewId },
      } };
    }
    if (typeof payload.id !== "string" || typeof payload.state !== "string")
      throw new Error("refused_by_guard");
    return { ok: true, result: {
      done: payload.state === "SUCCEEDED",
      confirmed: payload.state === "SUCCEEDED" ? true :
        payload.state === "UNKNOWN" ? null : false,
      state: payload.state, operation: payload,
      logged: { id: payload.id },
    } };
  }
  const { domainArgs, paths } = parseRtcReadInput(args);
  const result = await mcpRead(ctx, client => client.callTool({ name, arguments: domainArgs }));
  if (result.isError) throw new Error("refused_by_guard");
  const payload = projectRtcRead(result.structuredContent ?? { content: result.content }, paths);
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") <= 8192) return { ok: true, result: payload };
  // Keep the raw sanitized MCP output owned by this pass; never cut mid-JSON.
  const handle = await storeRtcResult(ctx, payload as Record<string, unknown>);
  return { ok: true, result: { summary: "Result saved for 24 hours", count: 1, preview: serialized.slice(0, 512) },
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
