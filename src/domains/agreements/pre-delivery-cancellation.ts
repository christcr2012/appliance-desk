import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { SUCCESSFUL_PAYMENT_STATUSES, HELD_PAYMENT_STATUS } from "@/domains/billing/payment-status";
import { requireRole } from "@/lib/session";
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
  signedAt: Date | null;
  now: Date;
  hours: number;
  policy: CancellationPolicy;
}) {
  const largeOrder = input.downPaymentCents > 0;
  const withinWindow = Boolean(input.signedAt &&
    input.now.getTime() - input.signedAt.getTime() <= input.hours * 60 * 60 * 1000);
  const mayRetain = largeOrder && !withinWindow;
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
      stripeSubscriptionId: true, customerId: true,
    },
  });
  if (!canTransitionAgreementStatus(agreement.status, "CANCELLED").ok ||
      agreement.firstDeliveredOn || agreement.billingStartedAt) {
    throw new Error("This is not an eligible before-delivery cancellation. Use the ending and return workflow.");
  }
  const otherPayments = await tx.payment.count({ where: { invoice: { agreementId }, status: { in: [...SUCCESSFUL_PAYMENT_STATUSES, HELD_PAYMENT_STATUS] } } });
  const deposits = await tx.deposit.count({ where: { agreementId, amountCents: { gt: 0 }, refundedAt: null } });
  if (otherPayments || deposits) throw new Error("Other invoice payments or refundable deposits need finance reconciliation before cancelling.");
  const firstInvoiceApplication = await tx.signingFirstInvoiceApplication.findUnique({
    where: { agreementId }, select: { agreementId: true },
  });
  if (firstInvoiceApplication) {
    throw new Error("The first bill already used signing funds. Reconcile the invoice before cancelling.");
  }
  await tx.$queryRaw`SELECT "agreementId" FROM "AgreementSigningPayment" WHERE "agreementId" = ${agreementId} FOR UPDATE`;
  const obligation = await tx.agreementSigningPayment.findUnique({
    where: { agreementId }, include: {
      receipt: { select: { id: true, customerId: true, amountCents: true } },
      attempts: {
        where: { status: { in: ["PREPARED", "PENDING"] }, method: "STRIPE_CHECKOUT" },
        select: { status: true, method: true },
      },
    },
  });
  if (obligation?.attempts.some(attempt =>
      attempt.method === "STRIPE_CHECKOUT" && ["PREPARED", "PENDING"].includes(attempt.status)
    )) {
    throw new Error("A signing card payment is still pending or unverified. Reconcile it before cancelling.");
  }
  if (obligation?.status === "SETTLED" &&
      (!obligation.receipt || obligation.receipt.customerId !== agreement.customerId ||
        obligation.receipt.amountCents !== obligation.totalCents || !obligation.receiptId)) {
    throw new Error("The signed payment and receipt disagree. Finance reconciliation is required.");
  }
  if (obligation?.status !== "SETTLED" && obligation?.receiptId) {
    throw new Error("A receipt exists without a settled obligation. Finance reconciliation is required.");
  }
  const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" },
    select: { largeOrderCancellationFullRefundHours: true, updatedAt: true } });
  const hours = settings?.largeOrderCancellationFullRefundHours ?? 72;
  const receivedCents = obligation?.status === "SETTLED" ? obligation.receipt!.amountCents : 0;
  const defaultPolicy: CancellationPolicy = receivedCents > 0 && obligation &&
      obligation.downPaymentCents > 0 && obligation.signedAt &&
      now.getTime() - obligation.signedAt.getTime() > hours * 3600000
    ? "RETAIN_SETUP" : "FULL_REFUND";
  const policy = policyOverride ?? defaultPolicy;
  const amounts = calculatePreDeliveryCancellationAmounts({
    receivedCents,
    setupFeeCents: obligation?.setupFeeCents ?? 0,
    setupTaxCents: obligation?.setupTaxCents ?? 0,
    downPaymentCents: obligation?.downPaymentCents ?? 0,
    signedAt: obligation?.signedAt ?? null, now, hours, policy,
  });
  const signingAmountCents = receivedCents;
  const receiptId = obligation?.status === "SETTLED" ? obligation.receiptId : null;
  const fingerprint = createHash("sha256").update(JSON.stringify([
    agreementId, agreement.status, obligation?.status,
    obligation?.orderFingerprint, receiptId, receivedCents,
    obligation?.signedAt?.toISOString(), obligation?.setupFeeCents,
    obligation?.setupTaxCents, obligation?.downPaymentCents, hours,
    settings?.updatedAt?.toISOString(), defaultPolicy,
  ])).digest("hex");
  return {
    agreementId, status: agreement.status, receiptId, signingAmountCents,
    refundableCents: amounts.refundableCents, retainedCents: amounts.retainedCents,
    setupAndTaxCents: (obligation?.setupFeeCents ?? 0) + (obligation?.setupTaxCents ?? 0),
    largeOrder: amounts.largeOrder, withinFullRefundWindow: amounts.withinWindow,
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
      },
    } });
    const closing = await closeAgreementInTx(tx, input.actorUserId, input.agreementId, "CANCELLED");
    return { closing, quote };
  });
  await runCloseAgreementContinuation(result.closing);
  return result.quote;
}
