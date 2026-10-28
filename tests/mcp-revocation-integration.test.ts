import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ actorId: "", role: "ADMIN" }));
vi.mock("@/lib/session", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(state.role)) throw new Error("Access denied");
    return { user: { id: state.actorId, role: state.role } };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { disconnectAssistant } from "@/app/desk/automations/assistant-actions";

const parsed = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("MCP disconnected grants on disposable PostgreSQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = "mcp-owner-" + suffix;
  const adminId = "mcp-admin-" + suffix;
  const clientOwner = "mcp-client-owner-" + suffix;
  const clientAdmin = "mcp-client-admin-" + suffix;
  const connectionOwner = "mcp-conn-owner-" + suffix;
  const connectionAdmin = "mcp-conn-admin-" + suffix;
  const as = (id: string, role: "OWNER" | "ADMIN") => {
    state.actorId = id;
    state.role = role;
  };
  const form = (id: string) => {
    const data = new FormData();
    data.set("id", id);
    return data;
  };

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: ownerId + "@example.test", role: "OWNER", name: "Test owner" },
      { id: adminId, email: adminId + "@example.test", role: "ADMIN", name: "Test admin" },
    ] });
    await prisma.oauthClient.createMany({ data: [clientOwner, clientAdmin].map((clientId) => ({
      id: clientId, clientId, scopes: ["ops:read"], contacts: [],
      redirectUris: ["https://assistant.example/callback"], postLogoutRedirectUris: [],
      grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"],
    })) });
    await prisma.mcpConnection.createMany({ data: [
      { id: connectionOwner, userId: ownerId, oauthClientId: clientOwner, label: "Owner assistant", scopes: ["ops:read"] },
      { id: connectionAdmin, userId: adminId, oauthClientId: clientAdmin, label: "Admin assistant", scopes: ["ops:read"] },
    ] });
    await prisma.oauthRefreshToken.create({ data: {
      id: "mcp-refresh-" + suffix, token: "synthetic-refresh-" + suffix,
      clientId: clientAdmin, userId: adminId, resources: [], requestedUserInfoClaims: [], scopes: ["ops:read"],
    } });
    await prisma.oauthAccessToken.create({ data: {
      id: "mcp-access-" + suffix, token: "synthetic-access-" + suffix,
      clientId: clientAdmin, userId: adminId, resources: [], requestedUserInfoClaims: [], scopes: ["ops:read"],
    } });
    await prisma.oauthConsent.create({ data: {
      id: "mcp-consent-" + suffix, userId: adminId, clientId: clientAdmin,
      resources: [], requestedUserInfoClaims: [], scopes: ["ops:read"],
    } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "McpConnection", entityId: { in: [connectionOwner, connectionAdmin] } } });
    await prisma.mcpConnection.deleteMany({ where: { id: { in: [connectionOwner, connectionAdmin] } } });
    await prisma.oauthClient.deleteMany({ where: { id: { in: [clientOwner, clientAdmin] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
  });

  it("refuses an admin acting on another person's connection", async () => {
    as(adminId, "ADMIN");
    await expect(disconnectAssistant(form(connectionOwner))).rejects.toThrow(/already disconnected|no longer available/);
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connectionOwner } })).revokedAt).toBeNull();
  });

  it("does not trust a cached owner role after database downgrade", async () => {
    as(ownerId, "OWNER");
    await prisma.user.update({ where: { id: ownerId }, data: { role: "STAFF" } });
    try {
      await expect(disconnectAssistant(form(connectionAdmin))).rejects.toThrow(/no longer has access/);
      expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connectionAdmin } })).revokedAt).toBeNull();
    } finally {
      await prisma.user.update({ where: { id: ownerId }, data: { role: "OWNER" } });
    }
  });

  it("lets the active owner revoke an admin and its grants exactly once on concurrent submissions", async () => {
    as(ownerId, "OWNER");
    const results = await Promise.allSettled([
      disconnectAssistant(form(connectionAdmin)),
      disconnectAssistant(form(connectionAdmin)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: connectionAdmin } })).revokedAt).not.toBeNull();
    expect((await prisma.oauthRefreshToken.findFirstOrThrow({ where: { clientId: clientAdmin } })).revoked).not.toBeNull();
    expect((await prisma.oauthAccessToken.findFirstOrThrow({ where: { clientId: clientAdmin } })).revoked).not.toBeNull();
    expect(await prisma.oauthConsent.count({ where: { clientId: clientAdmin, userId: adminId } })).toBe(0);
  });
});
