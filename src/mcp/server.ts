import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentContext } from "@/domains/agent-control/authorization";

/** A separate stateless server instance for every authorized request. */
export function buildMcpServer(context: AgentContext): McpServer {
  const server = new McpServer({ name: "appliance-desk", version: "1.0.0" });
  const output = {
    name: context.name,
    role: context.role,
    scopes: context.scopes,
    connectionLabel: context.connectionLabel,
    environment: process.env.VERCEL_ENV === "production" ? "production" : "testing",
    revision: process.env.VERCEL_GIT_COMMIT_SHA ?? "not reported",
  };
  server.registerTool("appliance_whoami", {
    title: "Who am I connected as?",
    description: "Shows the active assistant permissions and the connected team account.",
    inputSchema: {},
    outputSchema: {
      name: z.string(), role: z.enum(["OWNER", "ADMIN"]), scopes: z.array(z.string()),
      connectionLabel: z.string(), environment: z.enum(["production", "testing"]), revision: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output }));
  return server;
}
