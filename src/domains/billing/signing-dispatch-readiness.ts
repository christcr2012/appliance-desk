import type { Prisma } from "@prisma/client";
import { customerSigningSummary, type CustomerSigningEvidence } from "@/domains/portal/signing-status";

export type SigningDispatchEvidence = {
  customerId: string;
  agreementStatus: string;
  hasSigningCharge: boolean;
  frozenOrderFingerprint: string | null;
  signature: {
    signedAt: Date | null;
    signingOrderFingerprint: string | null;
    signingAllInCents: number | null;
    signingEvidenceVersion: number | null;
  } | null;
  payment: (CustomerSigningEvidence & {
    orderFingerprint: string;
    evidenceVersion: number;
  }) | null;
};

const validFingerprint = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/**
 * Start of physical delivery is distinct from booking the date. Legacy rentals
 * with no W-22 signing preparation retain their existing status transition;
 * once any W-22 payment proof exists, missing or unverified terms fail closed.
 */
export function signingDispatchDecision(evidence: SigningDispatchEvidence):
  { allowed: true; legacy: boolean } | { allowed: false; reason: string } {
  const hasW22Proof = evidence.hasSigningCharge ||
    Boolean(evidence.payment) || Boolean(evidence.signature?.signingOrderFingerprint);
  if (!hasW22Proof) return { allowed: true, legacy: true };
  const blocked = (reason: string): { allowed: false; reason: string } => ({ allowed: false, reason });
  if (evidence.agreementStatus !== "ACTIVE") {
    return blocked("This rental is not a signed active agreement. Do not start delivery.");
  }
  const { signature, payment, customerId } = evidence;
  if (!signature || !payment || !validFingerprint(signature.signingOrderFingerprint) ||
      !validFingerprint(payment.orderFingerprint) ||
      !(signature.signedAt instanceof Date) ||
      !Number.isFinite(signature.signedAt.getTime()) ||
      signature.signingOrderFingerprint !== payment.orderFingerprint ||
      signature.signingAllInCents !== payment.totalCents ||
      signature.signingEvidenceVersion !== payment.evidenceVersion ||
      ![1,2].includes(payment.evidenceVersion) ||
      (evidence.hasSigningCharge && evidence.frozenOrderFingerprint !== signature.signingOrderFingerprint)) {
    return blocked("This order has no matching signed payment review. Recheck the signed agreement before delivery.");
  }
  if (!customerId || !Number.isSafeInteger(payment.totalCents) || payment.totalCents < 0 ||
      payment.signedAt.getTime() !== signature.signedAt.getTime()) {
    return blocked("The signing payment record is incomplete. Review it before delivery.");
  }
  const summary = customerSigningSummary(payment, customerId);
  if (summary?.status === "RECEIVED" ||
      (summary?.status === "NOT_DUE" && summary.totalCents === 0)) {
    return { allowed: true, legacy: false };
  }
  return blocked(
    "Verify the signed amount was actually received before starting delivery. A signature, pending payment or failed card attempt is not a receipt.",
  );
}

/** Read after locking the agreement in the same transaction that starts a job. */
export async function assertSigningPaymentReadyForDispatchInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
): Promise<void> {
  const a = await tx.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: {
      customerId: true, status: true,
      signingChargeSnapshot: { select: { id: true, frozenOrderFingerprint: true } },
      signature: { select: {
        signedAt: true, signingOrderFingerprint: true,
        signingAllInCents: true, signingEvidenceVersion: true,
      } },
      signingPaymentObligation: { select: {
        agreementId:true,componentEvidence:true,
        setupFeeCents: true, setupTaxCents: true, downPaymentCents: true,
        totalCents: true, status: true, signedAt: true,
        orderFingerprint: true, evidenceVersion: true,
        receipt: { select: { customerId: true, amountCents: true, receivedOn: true } },
      } },
    },
  });
  if (!a) throw new Error("The rental for this delivery is missing.");
  if (a.signingPaymentObligation?.evidenceVersion === 2) {
    // Unlike V1, V2 stores additional money categories outside the legacy
    // scalar fields. Physical dispatch must verify every historical source.
    const { getFrozenSigningOrderInTx } = await import("./signing-frozen-verify");
    const verified = await getFrozenSigningOrderInTx(tx, agreementId);
    if (!verified.some(row => row.agreementId === agreementId &&
        row.schemaVersion === 2 &&
        row.allInCents === a.signingPaymentObligation?.totalCents))
      throw new Error("Complete V2 signing evidence must be verified before delivery.");
  }
  const verdict = signingDispatchDecision({
    customerId: a.customerId,
    agreementStatus: a.status,
    hasSigningCharge: Boolean(a.signingChargeSnapshot),
    frozenOrderFingerprint: a.signingChargeSnapshot?.frozenOrderFingerprint ?? null,
    signature: a.signature,
    payment: a.signingPaymentObligation,
  });
  if (!verdict.allowed) throw new Error(verdict.reason);
}
