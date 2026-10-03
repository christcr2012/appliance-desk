import { prisma } from "@/lib/prisma";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { syncTerminationEnd } from "@/domains/billing/subscription-term";
import { formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing";
import { endAgreementOnAgreedDate, lockRentalAgreementInTx } from "./index";

/**
 * Carrying out an early ending that was agreed to.
 *
 * `requestEarlyTermination` records the ending date and the fee. This is what makes
 * the date happen, once a night, with nobody having to remember:
 *
 *   1. the agreement's fee (if any) becomes an ordinary OPEN invoice with one
 *      "Early ending fee" line. Nothing is charged automatically: the customer pays
 *      it like any other invoice and the owner can see it, adjust or write it off.
 *   2. the agreement ends on the agreed date through the normal ending path
 *      (equipment released, billing cancelled).
 *
 * A rental the customer paid for in advance is never ended here: how the unused,
 * already-paid months are settled (refund, credit or kept; the free month and the
 * discounts) needs the owner's eyes, so it is left on the owner's attention list.
 *
 * Safe to run twice: the fee invoice is only ever created once per agreement, and
 * an agreement that already ended is no longer a candidate.
 */

export type TerminationRunResult = {
  ended: number;
  feeInvoices: number;
  needsReview: Array<{ agreementId: string; message: string }>;
};

const PREPAID_MESSAGE =
  "This rental was paid in advance, so the unused months need your decision (refund, credit or keep). Open it to settle that and end the rental.";

async function createFeeInvoiceIfNeeded(agreementId: string): Promise<boolean> {
  const peek = await prisma.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { customerId: true },
  });
  if (!peek) return false;
  return prisma.$transaction(async (tx) => {
    // Same order as the billing code: the customer first, then the agreement.
    await lockCustomerLedger(tx, peek.customerId);
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    const fee = agreement.terminationFeeCents ?? 0;
    if (agreement.status !== "ACTIVE" || !agreement.terminationEffectiveOn || fee <= 0) return false;

    const already = await tx.invoiceLineItem.findFirst({
      where: { kind: "EARLY_TERMINATION_FEE", invoice: { agreementId } },
      select: { id: true },
    });
    if (already) return false;

    const effective = agreement.terminationEffectiveOn;
    const invoice = await tx.invoice.create({
      data: {
        customerId: agreement.customerId,
        agreementId,
        status: "OPEN",
        subtotalCents: fee,
        taxCents: 0,
        amountDueCents: fee,
        dueDate: effective,
        lineItems: {
          create: {
            kind: "EARLY_TERMINATION_FEE",
            description: `Early ending fee — rental ends ${formatBusinessDate(effective)}, before the end of its ${agreement.termMonths}-month term`,
            amountCents: fee,
            quantity: 1,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "agreement.termination_fee_invoiced",
        entityType: "Invoice",
        entityId: invoice.id,
        newValue: {
          agreementId,
          feeCents: fee,
          fee: formatCents(fee),
          policyVersion: agreement.terminationPolicyVersion,
          taxed: false,
        },
      },
    });
    return true;
  });
}

export async function executeAgreedTermination(
  agreementId: string,
  now: Date,
): Promise<{ ended: boolean; feeInvoiced: boolean; needsReview?: string }> {
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { status: true, terminationEffectiveOn: true, paidInFullInAdvance: true },
  });
  if (
    !agreement ||
    agreement.status !== "ACTIVE" ||
    !agreement.terminationEffectiveOn ||
    agreement.terminationEffectiveOn.getTime() > now.getTime()
  ) {
    return { ended: false, feeInvoiced: false };
  }
  if (agreement.paidInFullInAdvance) {
    return { ended: false, feeInvoiced: false, needsReview: PREPAID_MESSAGE };
  }

  // Normally confirmed days ago when the ending was requested; this just retries it.
  // Once the date has passed Stripe will not take an end date in the past, and the
  // normal ending below cancels the subscription anyway.
  try {
    await syncTerminationEnd(agreementId);
  } catch (error) {
    console.error(`Could not confirm the billing end date for ${agreementId} yet:`, error);
  }

  const feeInvoiced = await createFeeInvoiceIfNeeded(agreementId);
  // The rental's last day is the day before the ending date (it ends at the start of that day).
  const lastSecond = new Date(agreement.terminationEffectiveOn.getTime() - 1000);
  await endAgreementOnAgreedDate(agreementId, lastSecond);
  return { ended: true, feeInvoiced };
}

/** Nightly job: end every rental whose agreed ending date has arrived. One failure never blocks the others. */
export async function runDueTerminations(now = new Date()): Promise<TerminationRunResult> {
  const due = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", terminationEffectiveOn: { lte: now } },
    select: { id: true },
    orderBy: { terminationEffectiveOn: "asc" },
  });
  const result: TerminationRunResult = { ended: 0, feeInvoices: 0, needsReview: [] };
  for (const { id } of due) {
    try {
      const outcome = await executeAgreedTermination(id, now);
      if (outcome.ended) result.ended += 1;
      if (outcome.feeInvoiced) result.feeInvoices += 1;
      if (outcome.needsReview) result.needsReview.push({ agreementId: id, message: outcome.needsReview });
    } catch (error) {
      result.needsReview.push({ agreementId: id, message: error instanceof Error ? error.message : "Unknown error" });
    }
  }
  return result;
}
