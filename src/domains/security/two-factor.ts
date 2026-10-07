import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export type TwoFactorRequiredRole = "OWNER" | "ADMIN" | "STAFF";
export const RECOMMENDED_TWO_FACTOR_ROLES: readonly TwoFactorRequiredRole[] = [
  "OWNER",
  "ADMIN",
];

const TEAM_ROLES: readonly TwoFactorRequiredRole[] = ["OWNER", "ADMIN", "STAFF"];

export function twoFactorRolesFromSetting(value: unknown): TwoFactorRequiredRole[] {
  if (!Array.isArray(value)) return [...RECOMMENDED_TWO_FACTOR_ROLES];
  const selected = new Set(
    value.filter(
      (role): role is TwoFactorRequiredRole =>
        typeof role === "string" &&
        TEAM_ROLES.includes(role as TwoFactorRequiredRole),
    ),
  );
  return TEAM_ROLES.filter((role) => selected.has(role));
}

export function isTwoFactorEnrollmentExemptPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/desk/security/setup" ||
    pathname === "/login" ||
    pathname === "/login/two-factor" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/api/auth/")
  );
}

export function roleRequiresTwoFactor(role: Role | string, setting: unknown): boolean {
  if (role === "CUSTOMER") return false;
  return twoFactorRolesFromSetting(setting).includes(
    role as TwoFactorRequiredRole,
  );
}

export async function twoFactorEnrollmentRequired(
  userId: string,
  role: Role | string,
): Promise<boolean> {
  if (role === "CUSTOMER") return false;
  const [settings, user] = await Promise.all([
    prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { twoFactorRequiredRoles: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, archivedAt: true },
    }),
  ]);
  const required = roleRequiresTwoFactor(
    role,
    settings?.twoFactorRequiredRoles ?? RECOMMENDED_TWO_FACTOR_ROLES,
  );
  if (!required) return false;
  // A required account with missing/ambiguous enrollment state fails closed.
  return !user || user.archivedAt !== null || user.twoFactorEnabled !== true;
}

export async function assertTwoFactorEnrollment(
  userId: string,
  role: Role | string,
): Promise<void> {
  if (await twoFactorEnrollmentRequired(userId, role)) {
    throw new Error("Two-step login setup is required.");
  }
}

export async function setTwoFactorRequiredRoles(
  actorUserId: string,
  requestedRoles: readonly string[],
): Promise<TwoFactorRequiredRole[]> {
  const roles = TEAM_ROLES.filter((role) => requestedRoles.includes(role));
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { twoFactorRequiredRoles: true },
    });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", twoFactorRequiredRoles: roles },
      update: { twoFactorRequiredRoles: roles },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "security.two_factor.policy",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { roles: twoFactorRolesFromSetting(before?.twoFactorRequiredRoles) },
        newValue: { roles },
      },
    });
  });
  return roles;
}

export async function resetTwoFactorForRecovery(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, twoFactorEnabled: true },
    });
    if (!user) throw new Error("No account exists for that email.");
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "security.two_factor.recovery_reset",
        entityType: "User",
        entityId: user.id,
        oldValue: { twoFactorEnabled: user.twoFactorEnabled },
        newValue: {
          twoFactorEnabled: false,
          recoveryMethod: "trusted-script",
        },
      },
    });
    return user.email;
  });
}
