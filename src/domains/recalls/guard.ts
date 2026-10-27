// OPS-1: the checks every rent, reserve, swap, sale and parts-listing path calls. Kept free of heavy imports so any
// domain can use it without a circular import.
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class RecallError extends Error {}

export type HeldAction = "rented" | "reserved" | "swapped in" | "made available" | "sold" | "listed for parts";

/** Throws when this machine is on a recall hold. Call inside the transaction that would rent, reserve, swap or sell it. */
export async function assertNotRecallHeld(tx: Tx, applianceId: string, action: HeldAction): Promise<void> {
  const unit = await tx.appliance.findUnique({
    where: { id: applianceId },
    select: { assetNumber: true, recallHold: true },
  });
  if (unit?.recallHold) {
    throw new RecallError(
      `${unit.assetNumber} is on a recall hold, so it can't be ${action}. Finish the recall fix first, then release the hold on the Recalls page.`,
    );
  }
}

/**
 * Before any used-appliance sale or parts listing: the machine itself, and any machine of the SAME maker and model that
 * Chris has already confirmed a recall for, because the recall covers the model, not one serial number.
 */
export async function assertNotRecalledForSale(tx: Tx, applianceId: string, action: "sold" | "listed for parts" = "sold"): Promise<void> {
  await assertNotRecallHeld(tx, applianceId, action);
  const unit = await tx.appliance.findUnique({
    where: { id: applianceId },
    select: { assetNumber: true, manufacturer: true, model: true },
  });
  const maker = unit?.manufacturer?.trim();
  const model = unit?.model?.trim();
  if (!unit || !maker || !model) return;
  const same = await tx.recallMatch.findFirst({
    where: {
      state: "CONFIRMED",
      appliance: {
        manufacturer: { equals: maker, mode: "insensitive" },
        model: { equals: model, mode: "insensitive" },
      },
    },
    select: { title: true },
  });
  if (same) {
    throw new RecallError(
      `${unit.assetNumber} can't be ${action}: the recall "${same.title}" is confirmed for this maker and model. It is illegal to sell a recalled product.`,
    );
  }
}

/** Machines that are rentable right now except for a hold. Use in candidate lists. */
export const notOnRecallHold = { recallHold: false } as const;
