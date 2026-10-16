import { prisma } from "@/lib/prisma";
import { convertEstimateToAgreements } from "@/domains/estimates";
import { getPreparedEstimateQuote } from "@/domains/estimates/preapproval-quote";
import { sendForSignature } from "@/domains/agreements";
import { readOfferedSlots } from "./delivery";

export type ContinueResult =
  | { state: "SIGN"; path: string }
  | { state: "OWNER_REVIEW" | "WAITING" };

/**
 * The owner explicitly authorized a prepared one-site quote to progress.
 * Public access to an already-sent estimate does not grant arbitrary owner
 * permissions; the function can only convert preprepared frozen matching
 * shells belonging to THAT estimate, never add inventory or change money.
 */
export async function continueApprovedCustomerOrder(estimateId: string): Promise<ContinueResult> {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true, status: true, customerId: true, createdByUserId: true,
      customerAutoFinishEnabled: true, deliveryRequested: true,
      deliveryOffer: true, reviewedOrderFingerprint: true,
      reviewedQuoteFingerprint: true,
    },
  });
  if (!estimate || !["APPROVED", "CONVERTED"].includes(estimate.status))
    return { state: "WAITING" };
  if (!estimate.customerAutoFinishEnabled || !estimate.customerId ||
      !estimate.deliveryRequested || !readOfferedSlots(estimate.deliveryOffer).length)
    return { state: "OWNER_REVIEW" };
  const quote = await getPreparedEstimateQuote(estimateId);
  if (quote.status !== "READY" || quote.locations.length !== 1 ||
      quote.orderFingerprint !== estimate.reviewedOrderFingerprint ||
      quote.quoteFingerprint !== estimate.reviewedQuoteFingerprint)
    return { state: "OWNER_REVIEW" };

  // Preapproval prepared exactly one verified draft with frozen product lines;
  // an unprepared legacy estimate MUST be handled by the owner.
  const candidates = await prisma.rentalAgreement.findMany({
    where: { sourceEstimateId: estimateId },
    select: { id: true, customerId: true, serviceAddressId: true,
      status: true, lines: { select: { id: true } },
      signature: { select: { id: true } } },
  });
  if (candidates.length !== 1 ||
      candidates[0].customerId !== estimate.customerId ||
      candidates[0].serviceAddressId !== quote.locations[0].serviceAddressId ||
      !candidates[0].lines.length)
    return { state: "OWNER_REVIEW" };

  const actor = await prisma.user.findUnique({
    where: { id: estimate.createdByUserId }, select: { role: true } });
  if (!actor || !["OWNER", "ADMIN"].includes(actor.role)) return { state: "OWNER_REVIEW" };
  const agreements = await convertEstimateToAgreements(
    estimate.createdByUserId, estimateId, {
      mode: "single", serviceAddressId: candidates[0].serviceAddressId,
    },
  );
  if (agreements.length !== 1 || agreements[0] !== candidates[0].id)
    throw new Error("Prepared order identity changed.");
  if (candidates[0].signature)
    return { state: "SIGN", path: "/sign/" + candidates[0].signature.id };
  if (candidates[0].status !== "DRAFT") return { state: "OWNER_REVIEW" };
  try {
    const signature = await sendForSignature(estimate.createdByUserId, agreements[0]);
    return { state: "SIGN", path: "/sign/" + signature.id };
  } catch (error) {
    // Concurrent tab may have already created the same one-use signature.
    const existing = await prisma.signatureRecord.findUnique({
      where: { agreementId: agreements[0] }, select: { id: true },
    });
    if (existing) return { state: "SIGN", path: "/sign/" + existing.id };
    throw error;
  }
}
