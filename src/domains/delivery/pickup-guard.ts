import type { Prisma } from "@prisma/client";
import { readZoneSnapshot, snapshotLocation, type ZoneSnapshotLocation } from "./snapshot";

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

/**
 * ZONE-1 (Codex finding on PR #604): the zone that decides an agreement's delivery charge. Its own frozen copy (made at
 * conversion) wins; before conversion it is the source estimate's entry for the same address and customer — so a
 * prepared agreement signed before conversion is still checked against its estimate's current zone.
 */
export async function agreementZoneLocationInTx(tx: Prisma.TransactionClient, agreement: {
  serviceAddressId: string; deliveryZoneSnapshot: unknown; sourceEstimateId: string | null; customerId: string;
}): Promise<ZoneSnapshotLocation | null> {
  const own = agreement.deliveryZoneSnapshot
    ? readZoneSnapshot({ version: 1, locations: [agreement.deliveryZoneSnapshot] })?.locations[0] ?? null : null;
  if (own || !agreement.sourceEstimateId) return own;
  const estimate = await tx.estimate.findUnique({ where: { id: agreement.sourceEstimateId },
    select: { customerId: true, deliveryZoneSnapshot: true } });
  if (!estimate || estimate.customerId !== agreement.customerId) return null;
  return snapshotLocation(estimate.deliveryZoneSnapshot, agreement.serviceAddressId) ?? null;
}

/**
 * Signing (server and page) and phone orders: what the delivery window step needs. Pickup addresses need and accept
 * no window — even when windows were offered earlier, and even when those offers have since expired.
 */
export function deliveryWindowStep(input: { pickup: boolean; offeredCount: number; hasSelection: boolean }):
  "NONE" | "CHOOSE" {
  if (input.pickup) {
    if (input.hasSelection) throw new Error("You're picking the appliance up, so no delivery window is needed.");
    return "NONE";
  }
  if (input.offeredCount > 0) {
    if (!input.hasSelection) throw new Error("Select an offered delivery choice before signing.");
    return "CHOOSE";
  }
  if (input.hasSelection) throw new Error("This agreement has no current offered delivery choices.");
  return "NONE";
}

export const PICKUP_NO_DELIVERY_MESSAGE =
  "This rental is set to customer pickup, so it has no delivery visit. Arrange the pickup instead (or send a new quote with delivery).";
