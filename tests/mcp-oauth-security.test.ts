import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateMcpRequest } from "../src/domains/agent-control/authorization";

const fakes = vi.hoisted(() => ({
  verify: vi.fn(),
  connection: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
  mfaRequired: vi.fn(),
  rateLimited: vi.fn(),
}));

vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: () => ({ getActions: () => ({ verifyAccessTokenRequest: fakes.verify }) }),
}));
vi.mock("../src/lib/prisma", () => ({
  prisma: {
    mcpConnection: { findUnique: fakes.connection, updateMany: fakes.update },
    user: { findUnique: fakes.user },
  },
}));
vi.mock("../src/domains/security/two-factor", () => ({
  twoFactorEnrollmentRequired: fakes.mfaRequired,
}));
vi.mock("../src/lib/rate-limit", () => ({ isRateLimited: fakes.rateLimited }));

const issuerOriginal = process.env.MCP_ISSUER_URL;
const request = () => new Request("https://untrusted-caller.example/api/mcp", {
  headers: { Authorization: "Bearer fabricated-test-value" },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MCP_ISSUER_URL = "https://desk.example";
  fakes.verify.mockResolvedValue({ sub: "user-1", azp: "client-1", scope: "ops:read forbidden:write" });
  fakes.connection.mockResolvedValue({
    id: "connection-1", label: "Tester", scopes: ["ops:read", "decisions:read"],
    revokedAt: null, lastUsedAt: new Date(),
  });
  fakes.user.mockResolvedValue({ name: "Owner", role: "OWNER", archivedAt: null });
  fakes.mfaRequired.mockResolvedValue(false);
  fakes.rateLimited.mockResolvedValue(false);
  fakes.update.mockResolvedValue({ count: 1 });
});
afterEach(() => {
  if (issuerOriginal === undefined) delete process.env.MCP_ISSUER_URL;
  else process.env.MCP_ISSUER_URL = issuerOriginal;
});

describe("MCP request boundary", () => {
  it("refuses all traffic without an explicitly configured issuer", async () => {
    delete process.env.MCP_ISSUER_URL;
    expect((await authenticateMcpRequest(request()) as Response).status).toBe(404);
    expect(fakes.verify).not.toHaveBeenCalled();
  });
  it("requires bearer and names only canonical resource metadata", async () => {
    const response = await authenticateMcpRequest(new Request("https://malicious.example/api/mcp")) as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("https://desk.example/.well-known/oauth-protected-resource/api/mcp");
    expect(response.headers.get("www-authenticate")).not.toContain("malicious.example");
  });
  it("rejects a bad issuer, audience or signature rather than trusting token claims", async () => {
    fakes.verify.mockRejectedValue(new Error("bad audience"));
    expect((await authenticateMcpRequest(request()) as Response).status).toBe(401);
    expect(fakes.verify).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({
      verifyOptions: { issuer: "https://desk.example/api/auth", audience: "https://desk.example/api/mcp" },
    }));
  });
  it("refuses a disconnected or unknown connection immediately, even with a signed token", async () => {
    fakes.connection.mockResolvedValue({ id: "connection-1", revokedAt: new Date() });
    expect((await authenticateMcpRequest(request()) as Response).status).toBe(401);
    fakes.connection.mockResolvedValue(null);
    expect((await authenticateMcpRequest(request()) as Response).status).toBe(401);
  });
  it.each([
    [{ role: "CUSTOMER", archivedAt: null }, "downgraded role"],
    [{ role: "OWNER", archivedAt: new Date() }, "archived user"],
    [null, "deleted user"],
  ])("revokes access when the current account is invalid (%s, %s)", async (user) => {
    fakes.user.mockResolvedValue(user);
    expect((await authenticateMcpRequest(request()) as Response).status).toBe(403);
    expect(fakes.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "connection-1", revokedAt: null }),
      data: expect.objectContaining({ revokedReason: "Account access changed" }),
    }));
  });
  it("enforces current two-factor enrollment and quota", async () => {
    fakes.mfaRequired.mockResolvedValue(true);
    expect((await authenticateMcpRequest(request()) as Response).status).toBe(403);
    fakes.mfaRequired.mockResolvedValue(false);
    fakes.rateLimited.mockResolvedValue(true);
    const response = await authenticateMcpRequest(request()) as Response;
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
  it("returns only the intersection of issued and stored read scopes", async () => {
    const context = await authenticateMcpRequest(request());
    expect(context).toEqual(expect.objectContaining({
      userId: "user-1", role: "OWNER", connectionId: "connection-1", scopes: ["ops:read"],
    }));
  });
});
