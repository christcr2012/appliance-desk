import { randomUUID, createHash } from "node:crypto";
import { describe, beforeAll, afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { authenticateRtcPass, issueRtcPass, revokeRtcPass } from "@/domains/agent-control/passes";
import { readRtcResult, storeRtcResult } from "@/domains/agent-control/rtc-results";

const mocks = vi.hoisted(() => ({ twoFactorRequired: vi.fn(async () => false) }));
vi.mock("@/domains/security/two-factor", () => ({
  twoFactorEnrollmentRequired: mocks.twoFactorRequired,
}));
const suffix = randomUUID().slice(0, 12);
const ownerId = "rtc-owner-" + suffix;
const staffId = "rtc-staff-" + suffix;
const authReq = (secret: string, path = "/api/tools") =>
  new Request("http://localhost" + path, {
    headers: { authorization: "Bearer " + secret },
  });

describe("MCP-9 read-only RTC passes and handle ownership on disposable PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: ownerId + "@example.test", name: "Synthetic RTC owner", role: "OWNER" },
      { id: staffId, email: staffId + "@example.test", name: "Synthetic RTC staff", role: "STAFF" },
    ] });
  });
  afterAll(async () => {
    const connections = await prisma.mcpConnection.findMany({
      where: { userId: ownerId, kind: "PASS" }, select: { id: true },
    });
    const ids = connections.map(row => row.id);
    await prisma.agentResult.deleteMany({ where: { connectionId: { in: ids } } });
    await prisma.agentPass.deleteMany({ where: { connectionId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.mcpConnection.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  it("checks owner and duration before issuing anything", async () => {
    await expect(issueRtcPass(staffId, { label: "Staff blocked", scopes: ["ops:read"] }))
      .rejects.toThrow();
    await expect(issueRtcPass(ownerId, { label: "Too long", scopes: ["ops:read"], expiresDays: 31 }))
      .rejects.toThrow("INVALID_RTC_PASS_DURATION");
    await expect(issueRtcPass(ownerId, { label: "No access", scopes: [] }))
      .rejects.toThrow("INVALID_RTC_PASS_SCOPES");
  });

  it("stores only a digest and keeps OAuth/pass doors separate", async () => {
    const created = await issueRtcPass(ownerId, {
      label: "Synthetic read-only pass", scopes: ["ops:read", "decisions:read"],
    });
    const pass = await prisma.agentPass.findUniqueOrThrow({ where: { id: created.id } });
    const connection = await prisma.mcpConnection.findUniqueOrThrow({
      where: { id: created.connectionId },
    });
    expect(connection.kind).toBe("PASS");
    expect(connection.oauthClientId).toMatch(/^rtc-pass:/);
    expect(pass.digest).toBe(createHash("sha256").update(created.secret).digest("hex"));
    expect(JSON.stringify(pass)).not.toContain(created.secret);
    expect(pass.allowWrites).toBe(false);
    expect(pass.allowProduction).toBe(false);
    expect(pass.profile).toBe("read_only");
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(80_000_000);
    const context = await authenticateRtcPass(authReq(created.secret));
    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) throw new Error("Synthetic RTC authorization unexpectedly failed");
    expect(context.userId).toBe(ownerId);
    expect(context.scopes).toEqual(["ops:read", "decisions:read"]);

    const secretInUrl = await authenticateRtcPass(authReq(created.secret,
      "/api/tools?q=" + created.secret));
    expect(secretInUrl).toBeInstanceOf(Response);
    expect((secretInUrl as Response).status).toBe(401);
    const tokenShaped = await authenticateRtcPass(authReq("not-an-rtc-pass"));
    expect((tokenShaped as Response).status).toBe(401);

    // A multibyte result must be rejected by byte count before storing an unreadable handle.
    await expect(storeRtcResult(context, { rows: ["🧰".repeat(130_000)] }))
      .rejects.toThrow("RTC_RESULT_SIZE_INVALID");
    const handle = await storeRtcResult(context, { rows: ["sanitized"] });
    expect(await readRtcResult(context, handle)).toEqual({ rows: ["sanitized"] });
    await expect(readRtcResult({ ...context, connectionId: "someone-else" }, handle))
      .rejects.toThrow("RTC_RESULT_NOT_FOUND");
    await expect(readRtcResult(context, handle,
      new Date(Date.now() + 24 * 3600_000 + 1000))).rejects.toThrow("RTC_RESULT_NOT_FOUND");

    await revokeRtcPass(ownerId, created.id);
    expect((await authenticateRtcPass(authReq(created.secret))) instanceof Response).toBe(true);
    await expect(readRtcResult(context, handle)).rejects.toThrow("RTC_RESULT_NOT_FOUND");
  });

  it("requires owner opt-in for live read and prohibits live writes", async () => {
    const created = await issueRtcPass(ownerId, {
      label: "Synthetic live-read pass", scopes: ["ops:read"], allowProduction: true,
    });
    const stored = await prisma.agentPass.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.allowProduction).toBe(true);
    expect(stored.allowWrites).toBe(false);
    expect(stored.profile).toBe("read_only");
    await expect(issueRtcPass(ownerId, {
      label: "Unsafe live write", scopes: ["ops:read", "ops:maintain"],
      allowWrites: true, allowProduction: true,
    })).rejects.toThrow("RTC_LIVE_WRITES_NOT_ALLOWED");
    await revokeRtcPass(ownerId, created.id);
  });

  it("a test-only write pass is explicitly scoped and still requires the journal", async () => {
    await expect(issueRtcPass(ownerId, { label: "Unscoped synthetic write",
      scopes: ["ops:read"], allowWrites: true })).rejects.toThrow("INVALID_RTC_PASS_WRITE_SCOPE");
    const created = await issueRtcPass(ownerId, { label: "Synthetic write pass",
      scopes: ["ops:read", "ops:maintain"], areas: ["automation"], allowWrites: true });
    const pass = await prisma.agentPass.findUniqueOrThrow({ where: { id: created.id } });
    expect(pass.profile).toBe("full");
    expect(pass.allowWrites).toBe(true);
    expect(pass.allowProduction).toBe(false);
    const context = await authenticateRtcPass(authReq(created.secret));
    if (context instanceof Response) throw new Error("Test write pass unexpectedly rejected");
    expect(context.rtcAllowWrites).toBe(true);
    expect(context.rtcAreas).toEqual(["automation"]);
    expect(context.scopes).toContain("ops:maintain");
    expect(context.scopes).not.toContain("decisions:apply");
    await revokeRtcPass(ownerId, created.id);
  });

  it("atomic rate limiting shares one database bucket across parallel requests", async () => {
    // Distinct concurrent callers represent separate stateless instances.
    const { isRateLimited } = await import("@/lib/rate-limit");
    const limiterBucket = "rtc-limit-fixture-" + suffix;
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      isRateLimited(limiterBucket, { max: 4, windowMs: 60_000 })));
    expect(results.filter(Boolean)).toHaveLength(4);
    expect(results.filter(value => !value)).toHaveLength(4);
  });
});
