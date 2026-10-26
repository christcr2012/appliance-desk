import type { Prisma } from "@prisma/client";
import { snapshotLocation } from "./snapshot";

/**
 * ZONE-1: the ONE check every delivery-creating path uses (signing, payment settlement, staff-created delivery visits).
 * True when this agreement's address is "I'll pick it up": its own frozen zone (copied from the estimate at
 * conversion) or, before that copy exists, the source estimate's entry for the same address. Pure.
 */
export function isPickupAddress(agreementZone: unknown, estimateZone: unknown, serviceAddressId: string | null): boolean {
  const own = agreementZone as { choice?: unknown } | null | undefined;
  if (own && typeof own === "object" && own.choice === "CUSTOMER_PICKUP") return true;
  if (!serviceAddressId) return false;
  return snapshotLocation(estimateZone, serviceAddressId)?.choice === "CUSTOMER_PICKUP";
}

/** Reads what isPickupAddress needs for one agreement inside the caller's transaction. */
export async function isAgreementPickupInTx(tx: Prisma.TransactionClient, agreementId: string): Promise<boolean> {
  const agreement = await tx.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { serviceAddressId: true, deliveryZoneSnapshot: true, sourceEstimateId: true, customerId: true },
  });
  if (!agreement) return false;
  if (isPickupAddress(agreement.deliveryZoneSnapshot, null, agreement.serviceAddressId)) return true;
  if (!agreement.sourceEstimateId) return false;
  const estimate = await tx.estimate.findUnique({ where: { id: agreement.sourceEstimateId },
    select: { customerId: true, deliveryZoneSnapshot: true } });
  return !!estimate && estimate.customerId === agreement.customerId &&
    isPickupAddress(null, estimate.deliveryZoneSnapshot, agreement.serviceAddressId);
}

export const PICKUP_NO_DELIVERY_MESSAGE =
  "This rental is set to customer pickup, so it has no delivery visit. Arrange the pickup instead (or send a new quote with delivery).";
