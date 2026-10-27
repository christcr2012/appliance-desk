import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { forgetTrustedDevicesInTx } from "./trusted-devices";

export type SessionSummary = {
  id: string;
  device: string;
  createdAt: Date;
  lastActiveAt: Date;
  current: boolean;
};

export function sessionDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const platform =
    /iPhone/i.test(userAgent) ? "iPhone" :
    /iPad/i.test(userAgent) ? "iPad" :
    /Android/i.test(userAgent) ? "Android device" :
    /Windows/i.test(userAgent) ? "Windows device" :
    /Macintosh|Mac OS X/i.test(userAgent) ? "Mac" :
    /Linux/i.test(userAgent) ? "Linux device" :
    "Device";
  const browser =
    /Edg\//i.test(userAgent) ? "Edge" :
    /Chrome\//i.test(userAgent) ? "Chrome" :
    /Firefox\//i.test(userAgent) ? "Firefox" :
    /Safari\//i.test(userAgent) ? "Safari" :
    null;
  return browser ? `${platform} · ${browser}` : platform;
}

export async function listOwnSessions(
  userId: string,
  currentToken: string,
): Promise<SessionSummary[]> {
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      token: true,
      userAgent: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    device: sessionDeviceLabel(row.userAgent),
    createdAt: row.createdAt,
    lastActiveAt: row.updatedAt,
    current: row.token === currentToken,
  }));
}

export async function revokeOtherSessions(
  userId: string,
  currentToken: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.session.findFirst({
      where: { userId, token: currentToken, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!current) {
      throw new Error("Current session could not be verified.");
    }
    const removed = await tx.session.deleteMany({
      where: { userId, token: { not: currentToken } },
    });
    // ACC-6: signing out everywhere forgets remembered devices, so the next sign-in asks for a code again.
    await forgetTrustedDevicesInTx(tx, userId);
    await tx.auditLog.create({
      data: {
        userId,
        action: "security.sessions.revoke_others",
        entityType: "User",
        entityId: userId,
        newValue: { revokedCount: removed.count },
      },
    });
    return removed.count;
  });
}

export async function revokeStaffSessionsByOwner(
  ownerUserId: string,
  staffUserId: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    const target = await tx.user.findUnique({
      where: { id: staffUserId },
      select: { id: true, role: true, email: true },
    });
    if (!target || (target.role !== "STAFF" && target.role !== "ADMIN")) {
      throw new Error("Only a staff or admin account can be signed out from the Team screen.");
    }
    const removed = await tx.session.deleteMany({ where: { userId: staffUserId } });
    // ACC-6: signing someone out everywhere forgets their remembered devices too.
    await forgetTrustedDevicesInTx(tx, staffUserId);
    await tx.auditLog.create({
      data: {
        userId: ownerUserId,
        action: "security.sessions.revoke_staff",
        entityType: "User",
        entityId: staffUserId,
        newValue: {
          revokedCount: removed.count,
          targetEmail: target.email,
        },
      },
    });
    return removed.count;
  });
}
