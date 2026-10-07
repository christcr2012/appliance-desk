import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listOwnSessions,
  sessionDeviceText,
  signOutOtherSessions,
  signOutStaffEverywhere,
} from "@/domains/security/session-control";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("session control (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "g3-owner-" + tag;
  const adminId = "g3-admin-" + tag;
  const staffId = "g3-staff-" + tag;
  const ownerCurrentId = "g3-owner-current-" + tag;
  const ownerOtherId = "g3-owner-other-" + tag;
  const staffSessionA = "g3-staff-a-" + tag;
  const staffSessionB = "g3-staff-b-" + tag;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `g3-owner-${tag}@example.test`, name: "G3 Owner", role: "OWNER", emailVerified: true },
        { id: adminId, email: `g3-admin-${tag}@example.test`, name: "G3 Admin", role: "ADMIN", emailVerified: true },
        { id: staffId, email: `g3-staff-${tag}@example.test`, name: "G3 Staff", role: "STAFF", emailVerified: true },
      ],
    });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.createMany({
      data: [
        { id: ownerCurrentId, userId: ownerId, token: "g3-owner-current-token-" + tag, expiresAt, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" },
        { id: ownerOtherId, userId: ownerId, token: "g3-owner-other-token-" + tag, expiresAt, userAgent: "Mozilla/5.0 (iPhone) Version/18 Safari/605" },
        { id: staffSessionA, userId: staffId, token: "g3-staff-a-token-" + tag, expiresAt, userAgent: "Mozilla/5.0 (Android) Chrome/140" },
        { id: staffSessionB, userId: staffId, token: "g3-staff-b-token-" + tag, expiresAt },
      ],
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId] } } });
    await prisma.session.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId] } } });
  });

  it("lists only the caller's active sessions and identifies the current device", async () => {
    const sessions = await listOwnSessions(ownerId, ownerCurrentId);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.id === ownerCurrentId)?.current).toBe(true);
    expect(sessions.every((session) => !session.id.startsWith("g3-staff-"))).toBe(true);
    expect(sessionDeviceText("Mozilla/5.0 (Windows NT 10.0) Chrome/140")).toBe("Chrome on Windows");
  });

  it("sign out everywhere else preserves the verified current session", async () => {
    await expect(signOutOtherSessions(ownerId, ownerCurrentId)).resolves.toBe(1);
    expect(await prisma.session.findUnique({ where: { id: ownerCurrentId } })).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { id: ownerOtherId } })).toBeNull();
    expect(await prisma.auditLog.findFirst({
      where: { userId: ownerId, action: "security.sessions.revoke_others" },
    })).not.toBeNull();
  });

  it("Owner can sign a Staff account out everywhere", async () => {
    await expect(signOutStaffEverywhere(ownerId, staffId)).resolves.toBe(2);
    expect(await prisma.session.count({ where: { userId: staffId } })).toBe(0);
    expect(await prisma.auditLog.findFirst({
      where: {
        userId: ownerId,
        action: "security.sessions.staff_revoke_all",
        entityId: staffId,
      },
    })).not.toBeNull();
  });

  it("Admin cannot revoke a Staff member's sessions", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.create({
      data: {
        id: "g3-staff-admin-deny-" + tag,
        userId: staffId,
        token: "g3-staff-admin-deny-token-" + tag,
        expiresAt,
      },
    });
    await expect(signOutStaffEverywhere(adminId, staffId)).rejects.toThrow(/no longer has access/i);
    expect(await prisma.session.count({ where: { userId: staffId } })).toBe(1);
  });
});
