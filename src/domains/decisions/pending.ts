import type { Prisma } from "@prisma/client";

/**
 * A save made on a setting's own screen is a newer decision than a change still waiting for its start date in
 * Decisions & reviews, so the waiting change is cancelled in the same transaction (and audited). Otherwise the older
 * waiting value would later overwrite the newer save. The nightly run marks a change applied before it saves, so a
 * change never cancels itself.
 */
export async function cancelPendingDecisionChangesInTx(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  subjectIds: (string | null | undefined)[],
  reason: string,
  now: Date = new Date(),
): Promise<number> {
  const ids = [...new Set(subjectIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return 0;
  const waiting = await tx.decisionScheduledChange.findMany({
    where: { subjectId: { in: ids }, appliedAt: null, cancelledAt: null },
    select: { id: true, subjectId: true, effectiveFrom: true },
  });
  for (const change of waiting) {
    await tx.decisionScheduledChange.update({ where: { id: change.id }, data: { cancelledAt: now } });
    await tx.auditLog.create({
      data: { userId: actorId, action: "decision.scheduled_cancelled",
        entityType: "DecisionScheduledChange", entityId: change.id,
        newValue: { subjectId: change.subjectId, effectiveFrom: change.effectiveFrom.toISOString(), reason } },
    });
  }
  return waiting.length;
}
