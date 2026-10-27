import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { AgentContext } from "../src/domains/agent-control/authorization";
import { buildMcpServer, boundMcpOutput } from "../src/mcp/server";

const fakes = vi.hoisted(() => ({
  actor: vi.fn(), health: vi.fn(), issues: vi.fn(), issue: vi.fn(), runs: vi.fn(),
  readiness: vi.fn(), backup: vi.fn(), decisions: vi.fn(), decision: vi.fn(),
}));
vi.mock("../src/mcp/tools/diagnostics", () => ({
  checkMcpActor: fakes.actor,
  healthOverview: fakes.health,
  issuesList: fakes.issues,
  issueGet: fakes.issue,
  automationRuns: fakes.runs,
  configurationReadiness: fakes.readiness,
  backupStatus: fakes.backup,
  decisionsList: fakes.decisions,
  decisionGet: fakes.decision,
}));

function actor(name: string, scopes: AgentContext["scopes"]): AgentContext {
  return {
    userId: name, name, connectionId: `connection-${name}`, connectionLabel: `assistant-${name}`,
    role: "OWNER", scopes,
  };
}
async function connect(context: AgentContext) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(context);
  const client = new Client({ name: "mcp-4-unit-client", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

afterEach(() => vi.clearAllMocks());

describe("MCP-4 diagnostic tool registry", () => {
  it("publishes precisely nine tools with readonly/idempotent annotations and input/output schemas", async () => {
    const { client, close } = await connect(actor("owner", ["ops:read", "decisions:read"]));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "appliance_automation_list_runs", "appliance_backup_get_status",
        "appliance_configuration_get_readiness", "appliance_decisions_get",
        "appliance_decisions_list", "appliance_health_get_issue",
        "appliance_health_get_overview", "appliance_health_list_issues", "appliance_whoami",
      ]);
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true, destructiveHint: false, idempotentHint: true,
        });
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.outputSchema?.type).toBe("object");
      }
    } finally { await close(); }
  });

  it("enforces scope per call and rejects unknown or invalid fields", async () => {
    const { client, close } = await connect(actor("reader", ["ops:read"]));
    fakes.health.mockResolvedValue({ states: {}, jobs: [] });
    try {
      const denied = await client.callTool({ name: "appliance_decisions_list", arguments: {} });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain("FORBIDDEN_SCOPE");
      expect(fakes.decisions).not.toHaveBeenCalled();

      const invalid = await client.callTool({ name: "appliance_health_list_issues",
        arguments: { limit: 101, injected: "private-value" } });
      expect(invalid.isError).toBe(true);
      expect(fakes.issues).not.toHaveBeenCalled();

      const unknown = await client.callTool({
        name: "appliance_health_get_overview", arguments: { unexpected: "private-value" },
      });
      expect(unknown.isError).toBe(true);
      expect(fakes.health).not.toHaveBeenCalled();

      const allowed = await client.callTool({
        name: "appliance_health_get_overview", arguments: {},
      });
      expect(allowed.isError).not.toBe(true);
      expect(allowed.structuredContent).toEqual({ states: {}, jobs: [] });
    } finally { await close(); }
  });

  it("never shares identity between simultaneous connections", async () => {
    const a = await connect(actor("one", ["ops:read"]));
    const b = await connect(actor("two", ["decisions:read"]));
    try {
      const [left, right] = await Promise.all([
        a.client.callTool({ name: "appliance_whoami", arguments: {} }),
        b.client.callTool({ name: "appliance_whoami", arguments: {} }),
      ]);
      expect(left.structuredContent).toMatchObject({ name: "one", scopes: ["ops:read"] });
      expect(right.structuredContent).toMatchObject({ name: "two", scopes: ["decisions:read"] });
      expect(JSON.stringify(left)).not.toContain("assistant-two");
      expect(JSON.stringify(right)).not.toContain("assistant-one");
    } finally { await Promise.all([a.close(), b.close()]); }
  });

  it("keeps results under 8 KB and carries the last returned issue cursor", () => {
    const issues = Array.from({ length: 80 }, (_, i) => ({
      id: `c${String(i).padStart(24, "0")}`, detail: "SAFE".repeat(100),
    }));
    const result = boundMcpOutput({ issues, nextCursor: "c9876543210000" });
    expect(JSON.stringify(result).length).toBeLessThan(8192);
    expect(result.truncated).toBe(true);
    const kept = result.issues as typeof issues;
    expect(kept.length).toBeLessThan(80);
    expect(result.nextCursor).toBe(kept.at(-1)?.id);
  });
});
