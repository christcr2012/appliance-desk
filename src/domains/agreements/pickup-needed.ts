import { prisma } from "@/lib/prisma";

/**
 * Rentals that are over or ending, still have appliances at the customer's, and have no pickup visit yet.
 * Read-only. A rental the owner already decided to end has its draft visit from that decision, so it never appears here.
 */
export async function agreementIdsNeedingPickup(
  now: Date,
  limit: number,
  customerId?: string,
): Promise<{ id: string; name: string; since: Date; dueOn: Date | null; customer: { phone: string | null; user: { email: string } } }[]> {
  const held = await prisma.applianceCustodyEpisode.findMany({
    // AR-0b: a customer-scoped read filters before the 500 limit.
    where: { endedOn: null, agreementId: { not: null }, ...(customerId ? { customerId } : {}) }, select: { agreementId: true }, distinct: ["agreementId"], take: 500,
  });
  const ids = held.map((h) => h.agreementId as string);
  if (ids.length === 0) return [];
  const agreements = await prisma.rentalAgreement.findMany({
    where: {
      id: { in: ids },
      ...(customerId ? { customerId } : {}),
      OR: [
        { status: "ENDED" },
        { status: "ACTIVE", OR: [{ terminationRequestedAt: { not: null } }, { endDate: { lte: now } }] },
      ],
      jobs: { none: { type: "REMOVAL", status: { not: "CANCELLED" } } },
    },
    select: { id: true, closedAt: true, endDate: true, terminationEffectiveOn: true, updatedAt: true,
      customer: { select: { phone: true, user: { select: { name: true, email: true } } } } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: limit,
  });
  return agreements.map((a) => ({
    id: a.id, name: a.customer.user.name ?? a.customer.user.email,
    since: a.closedAt ?? a.terminationEffectiveOn ?? a.endDate ?? a.updatedAt, dueOn: a.terminationEffectiveOn ?? a.endDate ?? null,
    customer: { phone: a.customer.phone ?? null, user: { email: a.customer.user.email } },
  }));
}

export async function agreementNeedsPickup(agreementId: string, now: Date): Promise<boolean> {
  const rows = await agreementIdsNeedingPickup(now, 200);
  return rows.some((row) => row.id === agreementId);
}
