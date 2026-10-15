import { getCancellationReserveInTx } from "@/domains/billing/signing-cancellation-reserve";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { SUCCESSFUL_PAYMENT_STATUSES, HELD_PAYMENT_STATUS } from "@/domains/billing/payment-status";
import { requireRole } from "@/lib/session";
import { getSigningCancellationPaymentInTx } from "@/domains/billing/signing-cancellation-readiness";
import { readSignedCancellationPolicyEvidence, type SignedCancellationPolicyEvidence } from "./signed-cancellation-policy";
import {
  lockRentalAgreementInTx,
  closeAgreementInTx,
  runCloseAgreementContinuation,
  canTransitionAgreementStatus,
} from "./index";

type Tx = Prisma.TransactionClient;
export type CancellationPolicy = "FULL_REFUND" | "RETAIN_SETUP";
export type PreDeliveryCancellationQuote = {
  agreementId: string;
  status: string;
  receiptId: string | null;
  signingAmountCents: number;
  refundableCents: number;
  retainedCents: number;
  setupAndTaxCents: number;
  largeOrder: boolean;
  withinFullRefundWindow: boolean;
  fullRefundHours: number;
  policyEvidenceStatus: "SIGNED" | "LEGACY_UNVERIFIED";
  largeOrderReasons: SignedCancellationPolicyEvidence["reasons"];
  defaultPolicy: CancellationPolicy;
  fingerprint: string;
  signedAt: Date | null;
  refundState: "NOT_REQUIRED" | "PENDING_EXTERNAL_REFUND";
};

export function calculatePreDeliveryCancellationAmounts(input: {
  receivedCents: number;
  setupFeeCents: number;
  setupTaxCents: number;
  downPaymentCents: number;
  /** Signed, order-level classification; advances are NOT evidence of size. */
  largeOrder?: boolean;
  signedAt: Date | null;
  now: Date;
  hours: number;
  policy: CancellationPolicy;
}) {
  if (!Number.isSafeInteger(input.hours) || input.hours < 1 || input.hours > 720 ||
      !(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) ||
      (input.signedAt !== null && (!(input.signedAt instanceof Date) ||
        !Number.isFinite(input.signedAt.getTime())))) {
    throw new Error("Signed cancellation timing needs finance reconciliation.");
  }
  const largeOrder = input.largeOrder ?? input.downPaymentCents > 0;
  const elapsed = input.signedAt
    ? input.now.getTime() - input.signedAt.getTime() : null;
  const withinWindow = elapsed !== null && elapsed >= 0 &&
    elapsed <= input.hours * 60 * 60 * 1000;
  const mayRetain = largeOrder && elapsed !== null &&
    elapsed > input.hours * 60 * 60 * 1000;
  if (input.policy === "RETAIN_SETUP" && !mayRetain) {
    throw new Error("This cancellation must return the full signing payment.");
  }
  const retainedCents = input.policy === "RETAIN_SETUP"
    ? input.setupFeeCents + input.setupTaxCents : 0;
  if (!Number.isSafeInteger(retainedCents) || retainedCents < 0 ||
      retainedCents > input.receivedCents) {
    throw new Error("Signing receipt and cancellation amounts need finance reconciliation.");
  }
  return {
    retainedCents, refundableCents: input.receivedCents - retainedCents,
    largeOrder, withinWindow,
  };
}

/**
 * Read the financial evidence in the same transaction and after the
 * agreement row lock when used to approve. No client-supplied cents.
 * An in-flight provider payment is not equivalent to "unpaid".
 */
async function quoteInTx(tx: Tx, agreementId: string, now: Date, policyOverride?: CancellationPolicy) {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      id: true, status: true, firstDeliveredOn: true, billingStartedAt: true,
      stripeSubscriptionId: true, customerId: true, depositCents:true,
    },
  });
  if (!canTransitionAgreementStatus(agreement.status, "CANCELLED").ok ||
      agreement.firstDeliveredOn || agreement.billingStartedAt) {
    throw new Error("This is not an eligible before-delivery cancellation. Use the ending and return workflow.");
  }
  const otherPayments = await tx.payment.count({ where: { invoice: { agreementId }, status: { in: [...SUCCESSFUL_PAYMENT_STATUSES, HELD_PAYMENT_STATUS] } } });
  if (otherPayments) throw new Error("Other invoice payments or refundable deposits need finance reconciliation before cancelling.");
  const firstInvoiceApplication = await tx.signingFirstInvoiceApplication.findUnique({
    where: { agreementId }, select: { agreementId: true },
  });
  if (firstInvoiceApplication) {
    throw new Error("The first bill already used signing funds. Reconcile the invoice before cancelling.");
  }
  const obligation = await getSigningCancellationPaymentInTx(tx, agreementId, agreement.customerId);
  const reserve = obligation ? await getCancellationReserveInTx(tx, {
    ...obligation, agreementDepositCents:agreement.depositCents,
  }) : null;
  if (!obligation && await tx.deposit.count({where:{agreementId,amountCents:{gt:0}}}))
    throw new Error("Other refundable deposits require finance reconciliation before cancelling.");
  // A new signature freezes the original order's machine count, customer
  // classification and refund window. Current mutable BusinessSettings NEVER
  // reprices that agreement. Old unsigned policy histories cannot be invented:
  // legacy obligations are FULL_REFUND-only until reviewed with counsel.
  const signedPolicy: SignedCancellationPolicyEvidence | null = obligation
    ? readSignedCancellationPolicyEvidence(obligation.cancellationPolicyEvidence, {
      agreementId, orderFingerprint: obligation.orderFingerprint,
      signedAt: obligation.signedAt,
    }) : null;
  const hours = signedPolicy?.fullRefundHours ?? 72;
  const receivedCents = obligation?.status === "SETTLED" ? obligation.receipt!.amountCents : 0;
  const elapsed = obligation?.signedAt ? now.getTime() - obligation.signedAt.getTime() : null;
  const defaultPolicy: CancellationPolicy = receivedCents > 0 && signedPolicy?.largeOrder &&
      elapsed !== null && elapsed > hours * 3600000
    ? "RETAIN_SETUP" : "FULL_REFUND";
  const policy = policyOverride ?? defaultPolicy;
  const amounts = calculatePreDeliveryCancellationAmounts({
    receivedCents,
    setupFeeCents: obligation?.setupFeeCents ?? 0,
    setupTaxCents: obligation?.setupTaxCents ?? 0,
    downPaymentCents: obligation?.downPaymentCents ?? 0,
    largeOrder: signedPolicy?.largeOrder ?? false,
    signedAt: obligation?.signedAt ?? null, now, hours, policy,
  });
  const signingAmountCents = receivedCents;
  const receiptId = obligation?.status === "SETTLED" ? obligation.receiptId : null;
  const fingerprint = createHash("sha256").update(JSON.stringify([
    agreementId, agreement.status, obligation?.status,
    obligation?.orderFingerprint, receiptId, receivedCents,
    obligation?.signedAt?.toISOString(), obligation?.setupFeeCents,
    obligation?.setupTaxCents, obligation?.downPaymentCents, hours,
    signedPolicy, defaultPolicy,
  ])).digest("hex");
  return {
    agreementId, status: agreement.status, receiptId, signingAmountCents,
    reserveId:reserve?.id ?? null,reserveCents:reserve?.amountCents ?? 0,
    refundableCents: amounts.refundableCents, retainedCents: amounts.retainedCents,
    setupAndTaxCents: (obligation?.setupFeeCents ?? 0) + (obligation?.setupTaxCents ?? 0),
    largeOrder: amounts.largeOrder, withinFullRefundWindow: amounts.withinWindow,
    fullRefundHours: hours,
    policyEvidenceStatus: signedPolicy ? "SIGNED" as const : "LEGACY_UNVERIFIED" as const,
    largeOrderReasons: signedPolicy?.reasons ?? [],
    signedPolicyEvidence: signedPolicy,
    defaultPolicy, fingerprint, signedAt: obligation?.signedAt ?? null,
    orderFingerprint: obligation?.orderFingerprint ?? null,
    refundState: amounts.refundableCents > 0
      ? "PENDING_EXTERNAL_REFUND" as const : "NOT_REQUIRED" as const,
  };
}

export async function getPreDeliveryCancellationQuote(agreementId: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.$transaction(tx => quoteInTx(tx, agreementId, new Date()));
}

/**
 * Owner/admin explicitly approves each cancellation after reviewing the
 * agreed terms. The persisted pending-refund record is a liability, NEVER
 * evidence of money returned. No money-out or automatic communication.
 */
export async function approvePreDeliveryCancellation(input: {
  agreementId: string;
  actorUserId: string;
  expectedFingerprint: string;
  policy: CancellationPolicy;
  reason: string;
  reviewedTerms: boolean;
}) {
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 500)
    throw new Error("Enter a cancellation reason (12–500 characters).");
  if (!input.reviewedTerms)
    throw new Error("Review the signed agreement and applicable refund terms before approving.");
  if (!["FULL_REFUND", "RETAIN_SETUP"].includes(input.policy))
    throw new Error("Choose an allowed refund policy.");
  const approvedAt = new Date();
  const result = await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, input.actorUserId, ["OWNER", "ADMIN"]);
    await lockRentalAgreementInTx(tx, input.agreementId);
    const quote = await quoteInTx(tx, input.agreementId, approvedAt, input.policy);
    if (quote.fingerprint !== input.expectedFingerprint)
      throw new Error("Agreement or payment changed. Refresh the cancellation review.");
    if (input.policy !== quote.defaultPolicy &&
        !reason.toLowerCase().includes("override")) {
      throw new Error("Document the policy override in your reason using the word override.");
    }
    await tx.preDeliveryCancellation.create({
      data: {
        agreementId: input.agreementId,
        receiptId: quote.receiptId,
        orderFingerprint: quote.orderFingerprint,
        policy: input.policy,
        signedAmountCents: quote.signingAmountCents,
        refundDueCents: quote.refundableCents,
        retainedCents: quote.retainedCents,
        reason,
        reviewedTerms: true,
        ...(quote.signedPolicyEvidence
          ? { signedPolicyEvidence: quote.signedPolicyEvidence as unknown as Prisma.InputJsonValue }
          : {}),
        approvedByUserId: input.actorUserId,
        approvedAt,
        refundState: quote.refundState,
      },
    });
    await tx.auditLog.create({ data: {
      userId: input.actorUserId, action: "agreement.pre_delivery_cancellation_approved",
      entityType: "RentalAgreement", entityId: input.agreementId,
      newValue: {
        policy: input.policy, receiptId: quote.receiptId,
        refundDueCents: quote.refundableCents, retainedCents: quote.retainedCents,
        refundState: quote.refundState, reason,
        reserveId:quote.reserveId,reserveCents:quote.reserveCents,
        signedPolicyVersion: quote.signedPolicyEvidence?.schemaVersion ?? null,
        signedPolicyReasons: quote.largeOrderReasons,
        fullRefundHours: quote.fullRefundHours,
      },
    } });
    const closing = await closeAgreementInTx(tx, input.actorUserId, input.agreementId, "CANCELLED");
    return { closing, quote };
  });
  await runCloseAgreementContinuation(result.closing);
  return result.quote;
}
