import type { Prisma } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";

type Tx = Prisma.TransactionClient;

/**
 * TFA-2 §6.7: the pay-instead choice locks the moment the delivery fee is
 * first decided due on a real sale (a READY record, or PENDING_RATE where
 * only the rate was missing). Returns when it locked, or null while the
 * choice is still free.
 */
export async function rdfHandlingLockedSince(tx: Tx): Promise<Date | null> {
  const first = await tx.retailDeliveryFeeRecord.findFirst({
    where: { status: { in: ["READY", "PENDING_RATE"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { createdAt: true },
  });
  return first?.createdAt ?? null;
}

/** Throws the plain-words refusal when the choice is locked. */
export async function assertRdfHandlingChangeable(tx: Tx): Promise<void> {
  const since = await rdfHandlingLockedSince(tx);
  if (since) {
    throw new Error(
      `Who pays the delivery fee can't change now: the fee already applies to a sale (locked since ${businessDateKey(since)}). Your CPA reviews it before January 1.`,
    );
  }
}
