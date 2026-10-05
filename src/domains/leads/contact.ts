import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Canonical "we actually contacted this lead" fact. Incidental Lead updates
 * (scoring, status metadata, qualification edits) must never reset win-back
 * staleness. The timestamp is monotonic so late/replayed provider events cannot
 * move contact history backwards.
 */
export async function recordRealContactInTx(
  tx: Prisma.TransactionClient,
  leadId: string,
  contactedAt: Date = new Date(),
): Promise<boolean> {
  const updated = await tx.lead.updateMany({
    where: {
      id: leadId,
      OR: [
        { lastRealContactAt: null },
        { lastRealContactAt: { lt: contactedAt } },
      ],
    },
    data: { lastRealContactAt: contactedAt },
  });
  return updated.count === 1;
}

export async function recordRealContact(
  leadId: string,
  contactedAt: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction((tx) => recordRealContactInTx(tx, leadId, contactedAt));
}
