import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { offerMatchesFrozenEvidence } from "@/domains/agreements/signing-offer-proof";
import { getFrozenSigningOrderInTx } from "./signing-frozen-verify";
import { buildFrozenSigningCheckoutPlan, type FrozenSigningCheckoutPlan } from "./signing-checkout-plan";

/**
 * Read-only, trusted payment preparation. A customer redirection/checkout
 * success is not settlement. No callers may accept an amount from the browser.
 * W-22 has no enabled checkout path until its provider operation, settlement
 * and credit replay contract is complete.
 */
export type ReviewedSigningPayment = {
  customerId: string;
  agreementId: string;
  signedAt: Date;
  plan: FrozenSigningCheckoutPlan;
};

export async function getReviewedSigningPayment(
  agreementId: string,
): Promise<ReviewedSigningPayment> {
  if (!agreementId) throw new Error("Agreement is required.");
  return prisma.$transaction(async (tx) => {
    const agreement = await tx.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { id: true, customerId: true, status: true,
        paidInFullInAdvance: true, depositCents: true, damageWaiverCents: true },
    });
    if (!agreement || agreement.status !== "ACTIVE" ||
        agreement.paidInFullInAdvance || agreement.depositCents !== 0 ||
        agreement.damageWaiverCents !== 0) {
      throw new Error("Signing payment is not eligible for automated collection.");
    }
    const signature = await tx.signatureRecord.findUnique({
      where: { agreementId },
      select: { signedAt: true, signingOrderFingerprint: true,
        signingAllInCents: true, signingEvidenceVersion: true },
    });
    if (!signature?.signedAt) {
      throw new Error("Customer signature is required before payment collection.");
    }
    const frozen = await getFrozenSigningOrderInTx(tx, agreementId);
    const target = frozen.find(row => row.agreementId === agreementId);
    if (!target || !offerMatchesFrozenEvidence(signature, target)) {
      throw new Error("Customer-accepted payment proof no longer matches the frozen order.");
    }
    const plan = buildFrozenSigningCheckoutPlan(frozen, agreementId);
    if (plan.allInCents !== signature.signingAllInCents ||
        plan.orderFingerprint !== signature.signingOrderFingerprint) {
      throw new Error("Frozen payment total does not match the signed offer.");
    }
    return { customerId: agreement.customerId, agreementId, signedAt: signature.signedAt, plan };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
