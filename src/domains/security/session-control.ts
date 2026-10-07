import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export type SessionSummary = {
  id: string;
  device: string;
  createdAt: Date;
  updatedAt: Date;
  current: boolean;
};

export function sessionDeviceText(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser =
    /Edg\//.test(userAgent) ? "Edge" :
    /Chrome\//.test(userAgent) ? "Chrome" :
    /Firefox\//.test(userAgent) ? "Firefox" :
    /Safari\//.test(userAgent) ? "Safari" :
    "Browser";
  const platform =
    /Windows/i.test(userAgent) ? "Windows" :
    /Android/i.test(userAgent) ? "Android" :
    /iPhone|iPad|iOS/i.test(userAgent) ? "iPhone/iPad" :
    /Mac OS|Macintosh/i.test(userAgent) ? "Mac" :
    /Linux/i.test(userAgent) ? "Linux" :
    "device";
  return `${browser} on ${platform}`;
}

export async function listOwnSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionSummary[]> {
  const rows = await prisma.session.findMany({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userAgent: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    device: sessionDeviceText(row.userAgent),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    current: row.id === currentSessionId,
  }));
}

export async function signOutOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId);

    const current = await tx.session.findFirst({
      where: {
        id: currentSessionId,
        userId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!current) {
      throw new Error("The current session could not be verified.");
    }

    const deleted = await tx.session.deleteMany({
      where: {
        userId,
        id: { not: currentSessionId },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "security.sessions.revoke_others",
        entityType: "User",
        entityId: userId,
        newValue: { revokedSessions: deleted.count },
      },
    });
    return deleted.count;
  });
}

export async function signOutStaffEverywhere(
  actingUserId: string,
  staffUserId: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actingUserId, ["OWNER"]);
    await tx.$queryRaw`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${staffUserId}
      FOR UPDATE
    `;
    const staff = await tx.user.findUnique({
      where: { id: staffUserId },
      select: { id: true, role: true },
    });
    if (!staff || staff.role !== "STAFF") {
      throw new Error("That account isn't a staff login.");
    }

    const deleted = await tx.session.deleteMany({
      where: { userId: staffUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: actingUserId,
        action: "security.sessions.staff_revoke_all",
        entityType: "User",
        entityId: staffUserId,
        newValue: { revokedSessions: deleted.count },
      },
    });
    return deleted.count;
  });
}
