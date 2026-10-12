import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getReviewedSigningPaymentInTx } from "./signing-payment-readiness";

export type SigningCollectionMethod = "STRIPE_CHECKOUT" | "MANUAL";
export type PreparedSigningAttempt = {
  id: string;
  agreementId: string;
  requestKey: string;
  attemptNumber: number;
  method: SigningCollectionMethod;
  amountCents: number;
  status: string;
};

// Reservation only. Does not contact Stripe, mark an obligation paid or
// authorize a manual receipt. Durable keys are server-generated per retry.
export async function prepareSigningPaymentAttempt(
  agreementId: string,
  method: SigningCollectionMethod,
  actingFinanceUserId?: string,
): Promise<PreparedSigningAttempt> {
  if (method !== "STRIPE_CHECKOUT" && method !== "MANUAL") {
    throw new Error("Unknown signing payment collection method.");
  }
  if (method === "MANUAL" && !actingFinanceUserId) {
    throw new Error("An authenticated OWNER or ADMIN is required for a manual collection attempt.");
  }
  const attempt = await prisma.$transaction(async tx => {
    if (method === "MANUAL") {
      await assertActiveTeamActor(tx, actingFinanceUserId!, ["OWNER", "ADMIN"]);
    }
    // Serialize on the same obligation row before checking active attempts:
    // READ COMMITTED ensures a waiting caller sees the first committed child.
    const locks = await tx.$queryRaw<Array<{ agreementId: string }>>`
      SELECT "agreementId" FROM "AgreementSigningPayment"
      WHERE "agreementId" = ${agreementId} FOR UPDATE
    `;
    if (locks.length !== 1) throw new Error("Signing obligation is missing.");
    // This rereads the actual signed evidence in the SAME serializable transaction.
    const reviewed = await getReviewedSigningPaymentInTx(tx, agreementId);
    const obligation = await tx.agreementSigningPayment.findUnique({
      where: { agreementId },
    });
    if (!obligation || obligation.status !== "AWAITING_PAYMENT" ||
        obligation.totalCents <= 0 || obligation.totalCents !== reviewed.plan.allInCents ||
        obligation.orderFingerprint !== reviewed.plan.orderFingerprint ||
        obligation.evidenceVersion !== reviewed.plan.evidenceVersion ||
        obligation.signedAt.getTime() !== reviewed.signedAt.getTime()) {
      throw new Error("Signed payment obligation is missing or no longer collectable.");
    }
    const existing = await tx.signingPaymentAttempt.findFirst({
      where: { agreementId, status: { in: ["PREPARED", "PENDING"] } },
      orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
    });
    if (existing) {
      if (existing.method !== method || existing.amountCents !== obligation.totalCents ||
          existing.orderFingerprint !== obligation.orderFingerprint) {
        throw new Error("An incompatible payment attempt already exists. Review before retrying.");
      }
      return existing;
    }
    const previous = await tx.signingPaymentAttempt.findFirst({
      where: { agreementId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    if (previous && previous.attemptNumber >= 100) {
      throw new Error("Payment retries require owner investigation.");
    }
    const attemptNumber = (previous?.attemptNumber ?? 0) + 1;
    const requestKey = "w22-sign-" + createHash("sha256")
      .update(JSON.stringify([agreementId, obligation.orderFingerprint, method, attemptNumber]))
      .digest("hex");
    return tx.signingPaymentAttempt.create({ data: {
      agreementId,
      requestKey,
      attemptNumber,
      method,
      status: "PREPARED",
      orderFingerprint: obligation.orderFingerprint,
      amountCents: obligation.totalCents,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return {
    id: attempt.id,
    agreementId: attempt.agreementId,
    requestKey: attempt.requestKey,
    attemptNumber: attempt.attemptNumber,
    method: attempt.method as SigningCollectionMethod,
    amountCents: attempt.amountCents,
    status: attempt.status,
  };
}
