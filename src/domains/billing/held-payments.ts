import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockCustomerLedger } from "./ledger";
import { HELD_PAYMENT_STATUS, HELD_TO_CREDIT_STATUS } from "./payment-status";

/**
 * Held payments: a card payment arrived after the owner had already written
 * the invoice off (or voided it). The money is recorded but waits here for the
 * owner (docs/OWNER-INPUTS.md IN-23). Three ways to settle each one, always
 * one payment at a time:
 *
 *   MARK_PAID  the customer did owe it: take the write-off back and record the
 *              invoice as paid (only for a written-off invoice)
 *   CREDIT     keep the money as account credit the customer can use later
 *   REFUND     send it back to the customer's card (see refunds.ts)
 */

export type HeldPaymentOption = "MARK_PAID" | "CREDIT" | "REFUND";

export type HeldRecommendation = {
  option: HeldPaymentOption;
  /** Plain-English reason shown next to the recommended choice. */
  reason: string;
};

export function recommendHeldPaymentOption(input: {
  invoiceStatus: InvoiceStatus;
  outstandingCents: number;
  canRefund: boolean;
}): HeldRecommendation {
  if (input.invoiceStatus === "WRITTEN_OFF" && input.outstandingCents > 0) {
    return {
      option: "MARK_PAID",
      reason:
        "The customer did owe this money. You had given up on collecting it and they paid anyway, so the honest record is that it was collected: take the write-off back and mark the invoice paid.",
    };
  }
  if (input.canRefund) {
    return {
      option: "REFUND",
      reason:
        "The customer did not owe this invoice (it was cancelled), so the fairest thing is to send the money back to their card. Choose credit instead only if they ask for it.",
    };
  }
  return {
    option: "CREDIT",
    reason:
      "This payment can't be refunded to a card from here, so keep it as account credit the customer can use on future bills.",
  };
}

export function availableHeldPaymentOptions(input: {
  invoiceStatus: InvoiceStatus;
  outstandingCents: number;
  canRefund: boolean;
}): HeldPaymentOption[] {
  const options: HeldPaymentOption[] = [];
  if (input.invoiceStatus === "WRITTEN_OFF" && input.outstandingCents > 0) options.push("MARK_PAID");
  options.push("CREDIT");
  if (input.canRefund) options.push("REFUND");
  return options;
}

export async function listHeldPayments() {
  const payments = await prisma.payment.findMany({
    where: { status: HELD_PAYMENT_STATUS },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amountCents: true,
      createdAt: true,
      stripeChargeId: true,
      receipt: { select: { stripeChargeId: true, source: true, receivedOn: true } },
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          amountDueCents: true,
          amountPaidCents: true,
          writtenOffReason: true,
          customer: { select: { id: true, user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
  return payments.map((p) => {
    const outstandingCents = Math.max(0, p.invoice.amountDueCents - p.invoice.amountPaidCents);
    const canRefund = Boolean(p.receipt?.stripeChargeId && p.receipt.source === "STRIPE");
    const facts = { invoiceStatus: p.invoice.status, outstandingCents, canRefund };
    return {
      id: p.id,
      amountCents: p.amountCents,
      receivedOn: p.receipt?.receivedOn ?? p.createdAt,
      customerId: p.invoice.customer.id,
      customerName: p.invoice.customer.user.name ?? p.invoice.customer.user.email,
      invoiceId: p.invoice.id,
      invoiceNumber: p.invoice.invoiceNumber,
      invoiceStatus: p.invoice.status,
      writtenOffReason: p.invoice.writtenOffReason,
      outstandingCents,
      recommendation: recommendHeldPaymentOption(facts),
      options: availableHeldPaymentOptions(facts),
    };
  });
}

function nextInvoiceStatus(due: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "OPEN";
  if (paid >= due) return "PAID";
  return "PARTIALLY_PAID";
}

/** Lock the customer, then the invoice, then the held payment, and return the facts. */
async function lockHeld(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  paymentId: string,
) {
  const identity = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { invoice: { select: { id: true, customerId: true } } },
  });
  if (!identity) throw new Error("Couldn't find that held payment.");
  await lockCustomerLedger(tx, identity.invoice.customerId);
  const invoiceRows = await tx.$queryRaw<
    Array<{ id: string; status: InvoiceStatus; amountDueCents: number; amountPaidCents: number }>
  >`SELECT "id", "status", "amountDueCents", "amountPaidCents" FROM "Invoice" WHERE "id" = ${identity.invoice.id} FOR UPDATE`;
  const paymentRows = await tx.$queryRaw<
    Array<{ id: string; status: string; amountCents: number; receiptId: string | null; invoiceId: string }>
  >`SELECT "id", "status", "amountCents", "receiptId", "invoiceId" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  const invoice = invoiceRows[0];
  const payment = paymentRows[0];
  if (!invoice || !payment) throw new Error("Couldn't find that held payment.");
  if (payment.status !== HELD_PAYMENT_STATUS) {
    throw new Error("This payment has already been dealt with.");
  }
  return { customerId: identity.invoice.customerId, invoice, payment };
}

/** The customer did owe it: take the write-off back and record the invoice as paid. */
export async function resolveHeldPaymentAsPaid(userId: string, paymentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const { customerId, invoice, payment } = await lockHeld(tx, paymentId);
    if (invoice.status !== "WRITTEN_OFF") {
      throw new Error("Only a written-off invoice can be marked paid. Choose credit or refund instead.");
    }
    const outstanding = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
    const applied = Math.min(payment.amountCents, outstanding);
    if (applied <= 0) {
      throw new Error("Nothing is still owed on this invoice. Choose credit or refund instead.");
    }
    const remainder = payment.amountCents - applied;
    const newPaid = invoice.amountPaidCents + applied;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaidCents: newPaid,
        status: nextInvoiceStatus(invoice.amountDueCents, newPaid),
        writtenOffAt: null,
        writtenOffReason: null,
        version: { increment: 1 },
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "succeeded",
        amountCents: applied,
        notes: "Held payment applied after the owner reversed the write-off.",
      },
    });
    if (remainder > 0) {
      await tx.customerCredit.create({
        data: {
          customerId,
          amountCents: remainder,
          remainingCents: remainder,
          reason: "Payment received above what was still owed",
          notes: `Remainder of held payment ${payment.id}.`,
          authorizedByUserId: userId,
          sourceType: "RECEIPT_OVERPAYMENT",
          sourceId: payment.receiptId ?? payment.id,
          side: null,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: "billing.held_payment_marked_paid",
        entityType: "Payment",
        entityId: payment.id,
        oldValue: { invoiceStatus: invoice.status },
        newValue: { appliedCents: applied, creditCents: remainder, invoiceId: invoice.id },
      },
    });
  });
}

/** Keep the money as account credit the customer can use later. */
export async function resolveHeldPaymentAsCredit(userId: string, paymentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const { customerId, invoice, payment } = await lockHeld(tx, paymentId);
    await tx.customerCredit.create({
      data: {
        customerId,
        amountCents: payment.amountCents,
        remainingCents: payment.amountCents,
        reason: "Payment received after an invoice was closed",
        notes: `Held payment ${payment.id} on invoice ${invoice.id}, kept as credit by the owner.`,
        authorizedByUserId: userId,
        sourceType: "HELD_PAYMENT",
        sourceId: payment.id,
        side: null,
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: HELD_TO_CREDIT_STATUS, notes: "Held payment kept as account credit." },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "billing.held_payment_to_credit",
        entityType: "Payment",
        entityId: payment.id,
        newValue: { creditCents: payment.amountCents, invoiceId: invoice.id },
      },
    });
  });
}
