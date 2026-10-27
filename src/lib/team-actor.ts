import type { Prisma } from "@prisma/client";

// ACCT-1: ACCOUNTANT joins the union so call sites may name it explicitly. The DEFAULT allowed set below
// stays OWNER/ADMIN/STAFF — an accountant is refused everywhere a call site does not list the role on purpose.
export type TeamRole = "OWNER" | "ADMIN" | "STAFF" | "ACCOUNTANT";

/**
 * Re-check a team actor inside the same database transaction as a business
 * mutation. The FOR SHARE lock serializes with staff deactivation's User-row
 * update: either the mutation commits while the actor is still active and
 * deactivation waits, or deactivation commits first and this guard rejects
 * the in-flight request before it can write business state.
 */
export async function assertActiveTeamActor(
  tx: Prisma.TransactionClient,
  userId: string,
  allowedRoles: readonly TeamRole[] = ["OWNER", "ADMIN", "STAFF"],
) {
  await tx.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR SHARE
  `;

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, archivedAt: true, accessEndsOn: true },
  });

  if (
    !user ||
    user.archivedAt ||
    !allowedRoles.includes(user.role as TeamRole) ||
    // ACCT-1: an accountant whose access end date has passed can do nothing, even with a live session.
    (user.role === "ACCOUNTANT" && user.accessEndsOn !== null && user.accessEndsOn.getTime() <= Date.now())
  ) {
    throw new Error("This account no longer has access to make that change.");
  }

  return user;
}
