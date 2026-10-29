import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildMcpServer } from "@/mcp/server";
import type { AgentContext } from "@/domains/agent-control/authorization";

const fakes = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), get: vi.fn(), preview: vi.fn() }));
vi.mock("@/mcp/tools/diagnostics", () => ({ checkMcpActor: fakes.actor }));
vi.mock("@/domains/agent-control/repair-cases", () => ({
  listRepairCases: fakes.list, getRepairCase: fakes.get,
}));
vi.mock("@/domains/agent-control/operations", () => ({
  previewAgentOperation: fakes.preview,
}));

async function connect(scopes: AgentContext["scopes"]) {
  const context: AgentContext = { userId: "owner-fixture", name: "Owner", role: "OWNER",
    connectionId: "synthetic-connection", connectionLabel: "Synthetic", scopes };
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(context);
  const client = new Client({ name: "repairs-test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

afterEach(() => vi.resetAllMocks());

describe("MCP-6 repair reads", () => {
  it("denies repair reads without ops:read before accessing records", async () => {
    const { client, close } = await connect([]);
    try {
      for (const { name, args } of [
        { name: "appliance_repair_list_cases", args: {} },
        { name: "appliance_repair_get_case", args: { id: "c123456789012345" } },
      ]) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain("FORBIDDEN_SCOPE");
      }
      expect(fakes.list).not.toHaveBeenCalled();
      expect(fakes.get).not.toHaveBeenCalled();
    } finally { await close(); }
  });

  it("returns bounded safe fields, not private actor IDs or raw evidence", async () => {
    const when = new Date("2026-10-28T12:00:00Z");
    const fixture = { id: "c123456789012345", number: 14, title: "Scheduled job failed",
      sourceKind: "SYSTEM_ISSUE", stage: "MERGED", blocker: null,
      prNumber: 704, createdAt: when, updatedAt: when, verifiedAt: null,
      expectedBehavior: "The job succeeds", howToCheck: "automation:backup",
      baselineRevision: "a".repeat(40), mergeSha: "b".repeat(40), deployedRevision: null,
      createdByUserId: "private-owner-id", evidence: [{ ref: "private-internal-evidence" }],
    };
    fakes.list.mockResolvedValue([fixture]);
    fakes.get.mockResolvedValue(fixture);
    const { client, close } = await connect(["ops:read"]);
    try {
      const listing = await client.callTool({ name: "appliance_repair_list_cases",
        arguments: { limit: 5 } });
      const detail = await client.callTool({ name: "appliance_repair_get_case",
        arguments: { id: fixture.id } });
      for (const result of [listing, detail]) {
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result)).not.toContain("private-owner-id");
        expect(JSON.stringify(result)).not.toContain("private-internal-evidence");
      }
      expect(fakes.list).toHaveBeenCalledWith("owner-fixture", 5);
      expect(fakes.get).toHaveBeenCalledWith("owner-fixture", fixture.id);
      expect((listing.structuredContent as { cases: unknown[] }).cases).toHaveLength(1);
    } finally { await close(); }
  });

  it("denies repair writes when the connection lacks repairs:write", async () => {
    const { client, close } = await connect(["ops:read"]);
    try {
      const result = await client.callTool({ name: "appliance_repair_create_case", arguments: {
        sourceKind: "SYSTEM_ISSUE", sourceId: "c123456789012345",
        expectedBehavior: "The backup finishes", howToCheck: "automation:backup",
        requestKey: "request_0123456789",
      } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("FORBIDDEN_SCOPE");
      expect(fakes.preview).not.toHaveBeenCalled();
    } finally { await close(); }
  });

  it("only previews a repair write, binding the owner-approved journal action", async () => {
    fakes.preview.mockResolvedValue({ previewId: "operation-test-123456", state: "PREVIEWED",
      summary: "Open repair", changes: [], costNote: null,
      approval: "OWNER_IN_APP", expiresAt: "2026-10-28T23:00:00Z" });
    const { client, close } = await connect(["repairs:write"]);
    try {
      const args = { sourceKind: "SYSTEM_ISSUE", sourceId: "c123456789012345",
        expectedBehavior: "The backup finishes", howToCheck: "automation:backup",
        requestKey: "request_0123456789" };
      const result = await client.callTool({ name: "appliance_repair_create_case", arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ approval: "OWNER_IN_APP", state: "PREVIEWED" });
      expect(fakes.preview).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner-fixture" }), {
        action: "REPAIR_CREATE_CASE",
        args: { sourceKind: args.sourceKind, sourceId: args.sourceId,
          expectedBehavior: args.expectedBehavior, howToCheck: args.howToCheck },
        requestKey: args.requestKey,
      });
    } finally { await close(); }
  });

  it("rejects unknown fields before attempting a database call", async () => {
    const { client, close } = await connect(["ops:read"]);
    try {
      const result = await client.callTool({ name: "appliance_repair_list_cases",
        arguments: { limit: 1, injected: "ignore" } });
      expect(result.isError).toBe(true);
      expect(fakes.list).not.toHaveBeenCalled();
    } finally { await close(); }
  });
});
