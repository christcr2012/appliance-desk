import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { mcpConnection: db } }));
vi.mock("@/mcp/issuer", () => ({ getMcpIssuer: () => "https://desk.example.test" }));
vi.mock("@/app/desk/automations/assistant-actions", () => ({ disconnectAssistant: vi.fn() }));
import { AssistantConnections } from "@/app/desk/automations/assistant-connections";

describe("AI assistants disconnect inventory", () => {
  it("keeps every active connection accessible beyond 30 old disconnected records", async () => {
    db.findMany.mockImplementation(async (query: { where: { userId?: string; revokedAt: unknown }; take?: number }) => {
      if (query.where.revokedAt === null) {
        return [{ id: "active-older", label: "Old but active assistant", scopes: ["ops:read"],
          revokedAt: null, user: { name: "Owner" } }];
      }
      return Array.from({ length: 30 }, (_, i) => ({ id: `historical-${i}`,
        label: `Historical assistant ${i}`, scopes: ["ops:read"],
        revokedAt: new Date(), user: { name: "Owner" } }));
    });
    const html = renderToStaticMarkup(await AssistantConnections({ userId: "owner-1", canSeeAll: false }));
    expect(html).toContain("Old but active assistant");
    expect(html).toContain('value="active-older"');
    expect(html).toContain("Historical assistant 29");
    expect(db.findMany).toHaveBeenCalledTimes(2);
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "owner-1", revokedAt: null },
    }));
    const activeRead = db.findMany.mock.calls.find((call) => call[0].where.revokedAt === null)?.[0];
    expect(activeRead).not.toHaveProperty("take");
    const historyRead = db.findMany.mock.calls.find((call) => call[0].where.revokedAt !== null)?.[0];
    expect(historyRead.take).toBe(30);
  });
});
