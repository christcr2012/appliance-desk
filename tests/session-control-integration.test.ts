import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listOwnSessions,
  revokeOtherSessions,
  revokeStaffSessionsByOwner,
} from "@/domains/security/sessions";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("session controls (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "g3-owner-" + tag;
  const adminId = "g3-admin-" + tag;
  const staffId = "g3-staff-" + tag;
  const now = Date.now();

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `g3-owner-${tag}@example.test`, name: "G3 Owner", role: "OWNER", emailVerified: true },
        { id: adminId, email: `g3-admin-${tag}@example.test`, name: "G3 Admin", role: "ADMIN", emailVerified: true },
        { id: staffId, email: `g3-staff-${tag}@example.test`, name: "G3 Staff", role: "STAFF", emailVerified: true },
      ],
    });
    await prisma.session.createMany({
      data: [
        {
          id: "g3-owner-current-" + tag,
          userId: ownerId,
          token: "g3-owner-current-token-" + tag,
          expiresAt: new Date(now + 86_400_000),
          userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit Safari/605.1.15",
        },
        {
          id: "g3-owner-other-" + tag,
          userId: ownerId,
          token: "g3-owner-other-token-" + tag,
          expiresAt: new Date(now + 86_400_000),
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0",
        },
        {
          id: "g3-staff-a-" + tag,
          userId: staffId,
          token: "g3-staff-a-token-" + tag,
          expiresAt: new Date(now + 86_400_000),
        },
        {
          id: "g3-staff-b-" + tag,
          userId: staffId,
          token: "g3-staff-b-token-" + tag,
          expiresAt: new Date(now + 86_400_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: [ownerId, adminId, staffId] } },
          { entityId: { in: [ownerId, adminId, staffId] } },
        ],
      },
    });
    await prisma.session.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId] } } });
  });

  it("lists own sessions and signs out everywhere else while keeping the current session", async () => {
    const before = await listOwnSessions(ownerId, "g3-owner-current-token-" + tag);
    expect(before).toHaveLength(2);
    expect(before.find((row) => row.current)?.device).toContain("Mac");

    await expect(
      revokeOtherSessions(ownerId, "g3-owner-current-token-" + tag),
    ).resolves.toBe(1);

    const remaining = await prisma.session.findMany({ where: { userId: ownerId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.token).toBe("g3-owner-current-token-" + tag);
  });

  it("lets Owner sign a Staff user out everywhere and records evidence", async () => {
    await expect(revokeStaffSessionsByOwner(ownerId, staffId)).resolves.toBe(2);
    expect(await prisma.session.count({ where: { userId: staffId } })).toBe(0);
    expect(await prisma.auditLog.findFirst({
      where: {
        userId: ownerId,
        entityId: staffId,
        action: "security.sessions.revoke_staff",
      },
    })).not.toBeNull();
  });

  it("refuses Admin attempting the Owner-only staff-session action", async () => {
    await prisma.session.create({
      data: {
        id: "g3-staff-admin-test-" + tag,
        userId: staffId,
        token: "g3-staff-admin-test-token-" + tag,
        expiresAt: new Date(now + 86_400_000),
      },
    });
    await expect(revokeStaffSessionsByOwner(adminId, staffId)).rejects.toThrow();
    expect(await prisma.session.count({ where: { userId: staffId } })).toBe(1);
  });
});
