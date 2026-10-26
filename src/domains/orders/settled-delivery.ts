import type { Prisma } from "@prisma/client";
import { readOfferedSlots, slotSchema } from "./delivery";
import { snapshotLocation } from "@/domains/delivery/snapshot";

/** The agreement's frozen zone, or else the estimate's entry for that address, says "I'll pick it up". */
export function isPickupAddress(agreementZone: unknown, estimateZone: unknown, serviceAddressId: string): boolean {
  const own = agreementZone as { choice?: unknown } | null | undefined;
  if (own && typeof own === "object" && own.choice === "CUSTOMER_PICKUP") return true;
  return snapshotLocation(estimateZone, serviceAddressId)?.choice === "CUSTOMER_PICKUP";
}

/**
 * Only verified receipt-backed settlement calls this, in the same transaction
 * as its immutable receipt. A signed form, webhook redirect or owner-provided
 * bank reference cannot independently create a requested visit.
 */
export async function requestPaidDeliveryInTx(
  tx: Prisma.TransactionClient, agreementId: string,
): Promise<string | null> {
  const agreement = await tx.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, customerId: true, sourceEstimateId: true,
      serviceAddressId: true, deliveryRequested: true, deliveryOffer: true,
      deliveryOfferActorUserId: true, deliveryZoneSnapshot: true,
      signingPaymentObligation: {
        select: { status: true, receiptId: true },
      },
    },
  });
  if (!agreement || agreement.signingPaymentObligation?.status !== "SETTLED" ||
      !agreement.signingPaymentObligation.receiptId)
    return null;
  const estimate = agreement.sourceEstimateId
    ? await tx.estimate.findUnique({
        where:{id:agreement.sourceEstimateId},
        select:{customerId:true,createdByUserId:true,
          deliveryRequested:true,deliveryOffer:true,deliveryZoneSnapshot:true},
      })
    : null;
  // ZONE-1: an address the customer picks up never gets a delivery visit, whatever request was kept.
  if (isPickupAddress(agreement.deliveryZoneSnapshot, estimate?.deliveryZoneSnapshot, agreement.serviceAddressId))
    return null;
  const source = estimate && estimate.customerId === agreement.customerId &&
    estimate.deliveryRequested
    ? {choice:estimate.deliveryRequested,offer:estimate.deliveryOffer,
        actorId:estimate.createdByUserId}
    : agreement.deliveryRequested && agreement.deliveryOfferActorUserId
    ? {choice:agreement.deliveryRequested,offer:agreement.deliveryOffer,
        actorId:agreement.deliveryOfferActorUserId}
    : null;
  if (!source) return null;
  const request = source.choice as Record<string, unknown>;
  const proposed = slotSchema.safeParse(request.slot);
  if (!proposed.success || !readOfferedSlots(source.offer)
    .some(x => x.id === proposed.data.id)) return null;
  // Settlement can arrive after the requested date (e.g., an ACH delay).
  // Never turn an elapsed choice into a live requested delivery.
  const { todayDenver }=await import("./delivery");
  if(proposed.data.date<todayDenver()){
    await tx.staffTask.upsert({where:{sourceKey:"w24-renew-offer:"+agreementId},
      create:{sourceKey:"w24-renew-offer:"+agreementId,
        createdByUserId:source.actorId,customerId:agreement.customerId,
        priority:"HIGH",
        note:"Payment settled after the chosen delivery date. Contact the renter to offer NEW windows; do not confirm the expired slot."},
      update:{}});
    return null;
  }
  const current = await tx.job.findFirst({
    where: { agreementId, type: "DELIVERY",
      status: { not: "CANCELLED" } },
    select: { id: true, requestedDeliveryAt: true,
      requestedDelivery: true, scheduledAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!current || current.scheduledAt) return null;
  if (!current.requestedDeliveryAt) {
    await tx.job.update({ where: { id: current.id },
      data: { requestedDelivery: source.choice,
        requestedDeliveryAt: new Date() } });
  }
  await tx.staffTask.upsert({
    where: { sourceKey: "w24-confirm-delivery:" + current.id },
    create: {
      createdByUserId: source.actorId,
      customerId: agreement.customerId, jobId: current.id,
      sourceKey: "w24-confirm-delivery:" + current.id,
      note: "Confirm the requested delivery " + proposed.data.date +
        " " + proposed.data.window +
        " after verifying the signed payment, assignment and visit conflicts.",
      priority: "HIGH",
    },
    update: {},
  });
  return current.id;
}
