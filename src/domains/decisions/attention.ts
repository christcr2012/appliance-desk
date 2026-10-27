import { prisma } from "@/lib/prisma";
import { startingValuesAppliedException } from "@/domains/exceptions/rules";
import type { ExceptionItem } from "@/domains/exceptions/rules";

/**
 * DEC-2: the To do item that tells the owner researched starting values are now running the app. It is computed, not
 * stored: it shows while starting values were applied after the owner last marked them reviewed
 * (`BusinessSettings.decisionsReviewedAt`).
 */
async function unreviewedStartingValues(): Promise<{ count: number; newest: Date | null }> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" }, select: { decisionsReviewedAt: true },
  });
  const since = settings?.decisionsReviewedAt ?? null;
  const where = {
    kind: "STARTING_VALUE_APPLIED", via: "MIGRATION",
    ...(since ? { createdAt: { gt: since } } : {}),
  };
  const [count, newest] = await Promise.all([
    prisma.decisionRecord.count({ where }),
    prisma.decisionRecord.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { count, newest: newest?.createdAt ?? null };
}

export async function countUnreviewedStartingValues(): Promise<number> {
  return (await unreviewedStartingValues()).count;
}

export async function listStartingValuesAttention(): Promise<{ rows: ExceptionItem[]; total: number }> {
  const { count, newest } = await unreviewedStartingValues();
  if (count === 0 || !newest) return { rows: [], total: 0 };
  return { rows: [startingValuesAppliedException({ count, newest })], total: 1 };
}

/** The owner has looked at the starting values: the To do item goes away until new ones are applied. */
export async function markStartingValuesReviewed(actorId: string, now: Date = new Date()): Promise<void> {
  const { assertActiveTeamActor } = await import("@/lib/team-actor");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    await tx.businessSettings.updateMany({ where: { id: "singleton" }, data: { decisionsReviewedAt: now } });
    await tx.auditLog.create({
      data: { userId: actorId, action: "decision.starting_values_reviewed", entityType: "BusinessSettings",
        entityId: "singleton", newValue: { reviewedAt: now.toISOString() } },
    });
  });
}
