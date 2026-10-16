import type { Prisma } from "@prisma/client";
import { readOfferedSlots, slotSchema } from "./delivery";

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
      serviceAddressId: true,
      signingPaymentObligation: {
        select: { status: true, receiptId: true },
      },
    },
  });
  if (!agreement?.sourceEstimateId ||
      agreement.signingPaymentObligation?.status !== "SETTLED" ||
      !agreement.signingPaymentObligation.receiptId)
    return null;
  const estimate = await tx.estimate.findUnique({
    where: { id: agreement.sourceEstimateId },
    select: { customerId: true, createdByUserId: true,
      deliveryRequested: true, deliveryOffer: true },
  });
  if (!estimate || estimate.customerId !== agreement.customerId ||
      !estimate.deliveryRequested) return null;
  const request = estimate.deliveryRequested as Record<string, unknown>;
  const proposed = slotSchema.safeParse(request.slot);
  if (!proposed.success || !readOfferedSlots(estimate.deliveryOffer)
    .some(x => x.id === proposed.data.id)) return null;
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
      data: { requestedDelivery: estimate.deliveryRequested,
        requestedDeliveryAt: new Date() } });
  }
  await tx.staffTask.upsert({
    where: { sourceKey: "w24-confirm-delivery:" + current.id },
    create: {
      createdByUserId: estimate.createdByUserId,
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
