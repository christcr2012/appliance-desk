import { prisma } from "@/lib/prisma";

/**
 * Rentals that are over or ending, still have appliances at the customer's, and have no pickup visit yet.
 * Read-only. A rental the owner already decided to end has its draft visit from that decision, so it never appears here.
 */
export async function agreementIdsNeedingPickup(now: Date, limit: number): Promise<{ id: string; name: string; since: Date; dueOn: Date | null }[]> {
  const held = await prisma.applianceCustodyEpisode.findMany({
    where: { endedOn: null, agreementId: { not: null } }, select: { agreementId: true }, distinct: ["agreementId"], take: 500,
  });
  const ids = held.map((h) => h.agreementId as string);
  if (ids.length === 0) return [];
  const agreements = await prisma.rentalAgreement.findMany({
    where: {
      id: { in: ids },
      OR: [
        { status: "ENDED" },
        { status: "ACTIVE", OR: [{ terminationRequestedAt: { not: null } }, { endDate: { lte: now } }] },
      ],
      jobs: { none: { type: "REMOVAL", status: { not: "CANCELLED" } } },
    },
    select: { id: true, closedAt: true, endDate: true, terminationEffectiveOn: true, updatedAt: true,
      customer: { select: { user: { select: { name: true, email: true } } } } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: limit,
  });
  return agreements.map((a) => ({
    id: a.id, name: a.customer.user.name ?? a.customer.user.email,
    since: a.closedAt ?? a.terminationEffectiveOn ?? a.endDate ?? a.updatedAt, dueOn: a.terminationEffectiveOn ?? a.endDate ?? null,
  }));
}

export async function agreementNeedsPickup(agreementId: string, now: Date): Promise<boolean> {
  const rows = await agreementIdsNeedingPickup(now, 200);
  return rows.some((row) => row.id === agreementId);
}
