import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "@/lib/prisma";
import { buildMcpServer } from "@/mcp/server";
import type { AgentContext } from "@/domains/agent-control/authorization";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP diagnostic permission changes on disposable Postgres", () => {
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const id = "mcp-read-admin-" + nonce;
  const staffId = "mcp-read-staff-" + nonce;
  const ctx: AgentContext = {
    userId: id, name: "Test admin", role: "ADMIN", connectionId: "connection-" + nonce,
    connectionLabel: "Test assistant", scopes: ["ops:read", "decisions:read"],
  };
  let client: Client;
  let server: ReturnType<typeof buildMcpServer>;
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id, name: "MCP test admin", role: "ADMIN", email: id + "@example.test" },
      { id: staffId, name: "MCP test staff", role: "STAFF", email: staffId + "@example.test" },
    ] });
    const [a, b] = InMemoryTransport.createLinkedPair();
    server = buildMcpServer(ctx);
    client = new Client({ name: "mcp-read-test", version: "1.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
  });
  afterAll(async () => {
    if (client) await client.close();
    if (server) await server.close();
    await prisma.user.deleteMany({ where: { id: { in: [id, staffId] } } });
    await prisma.$disconnect();
  });

  it("rechecks the actor role on every tool call, even on a long-lived connection", async () => {
    const request = () => client.callTool({
      name: "appliance_health_get_issue", arguments: { id: "c1234567890123" },
    });
    const allowed = await request();
    expect(allowed.isError).not.toBe(true);
    expect(allowed.structuredContent).toMatchObject({ found: false });

    await prisma.user.update({ where: { id }, data: { role: "STAFF" } });
    const denied = await request();
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain("MCP test admin");
    expect(JSON.stringify(denied)).toContain("TOOL_UNAVAILABLE");

    await prisma.user.update({ where: { id }, data: { role: "ADMIN", archivedAt: new Date() } });
    expect((await request()).isError).toBe(true);
  });
});
