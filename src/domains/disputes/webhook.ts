// OPS-5: the Stripe dispute events, applied inside the locked webhook transaction. Everything here reads only the event
// itself and our own rows (no network call), writes one PaymentDispute row, and never moves money: it records the
// dispute, flags it for Chris, and for a bank dispute switches autopay off for that customer.
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { disputeStateFromStripe, isFinalState, type DisputeStateName } from "./rules";

type Db = Prisma.TransactionClient;

export const DISPUTE_EVENT_TYPES = ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"] as const;

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function secondsToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

export async function handleDisputeEvent(db: Db, event: Stripe.Event): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  if (!dispute?.id) return;
  const eventAt = secondsToDate(event.created) ?? new Date();
  const chargeId = idOf(dispute.charge);
  const intentId = idOf(dispute.payment_intent);

  const payment = chargeId || intentId
    ? await db.payment.findFirst({
        where: {
          status: { not: "failed" },
          OR: [
            ...(intentId ? [{ stripePaymentIntentId: intentId }] : []),
            ...(chargeId ? [{ stripeChargeId: chargeId }] : []),
          ],
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, method: true, invoiceId: true, invoice: { select: { customerId: true } } },
      })
    : null;

  // The customer is locked first (same order as every other money writer), then the dispute row.
  const customerId = payment?.invoice.customerId ?? null;
  if (customerId) await db.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
  await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "stripeDisputeId" = ${dispute.id} FOR UPDATE`;
  const existing = await db.paymentDispute.findUnique({ where: { stripeDisputeId: dispute.id } });

  let state: DisputeStateName = disputeStateFromStripe(dispute.status);
  // The "closed" event always carries the outcome; trust it even if the status word is one we do not know.
  if (event.type === "charge.dispute.closed" && !isFinalState(state)) state = "CLOSED";

  if (existing) {
    // A final answer is never undone, and an older event arriving late never overwrites a newer one.
    if (isFinalState(existing.state as DisputeStateName) && !isFinalState(state)) return;
    if (!isFinalState(state) && eventAt.getTime() < existing.lastEventAt.getTime()) return;
    if (isFinalState(existing.state as DisputeStateName) && isFinalState(state) && eventAt.getTime() < existing.lastEventAt.getTime()) return;
  }

  const isBank = payment?.method === "ach";
  const final = isFinalState(state);
  const data = {
    stripeChargeId: chargeId,
    stripePaymentIntentId: intentId,
    paymentId: payment?.id ?? existing?.paymentId ?? null,
    invoiceId: payment?.invoiceId ?? existing?.invoiceId ?? null,
    customerId: customerId ?? existing?.customerId ?? null,
    amountCents: Math.max(0, Math.round(dispute.amount ?? 0)),
    reason: String(dispute.reason ?? "general").slice(0, 80),
    stripeStatus: String(dispute.status ?? "needs_response").slice(0, 60),
    state,
    isBank: isBank || existing?.isBank === true,
    dueBy: secondsToDate(dispute.evidence_details?.due_by),
    outcome: state === "WON" ? "won" : state === "LOST" ? "lost" : state === "CLOSED" ? "closed" : null,
    closedAt: final ? existing?.closedAt ?? eventAt : null,
    lastEventAt: eventAt,
    lastEventId: event.id,
  };

  if (!existing) {
    const created = await db.paymentDispute.create({
      data: { stripeDisputeId: dispute.id, openedAt: secondsToDate(dispute.created) ?? eventAt, ...data },
    });
    await db.auditLog.create({
      data: {
        userId: null, action: "dispute.opened", entityType: "PaymentDispute", entityId: created.id,
        newValue: { amountCents: data.amountCents, reason: data.reason, bank: data.isBank, matchedPayment: payment !== null },
      },
    });
    if (data.isBank && customerId) await blockBankDebits(db, customerId, created.id, eventAt);
    return;
  }

  await db.paymentDispute.update({ where: { id: existing.id }, data });
  if (state !== existing.state) {
    await db.auditLog.create({
      data: {
        userId: null, action: "dispute.state_changed", entityType: "PaymentDispute", entityId: existing.id,
        oldValue: { state: existing.state }, newValue: { state, stripeStatus: data.stripeStatus },
      },
    });
  }
  if (data.isBank && !existing.isBank && customerId) await blockBankDebits(db, customerId, existing.id, eventAt);
}

/** A bank dispute is final: switch off the saved bank method so autopay cannot debit it again, and remember why. */
async function blockBankDebits(db: Db, customerId: string, disputeId: string, at: Date): Promise<void> {
  await db.customer.update({
    where: { id: customerId },
    data: {
      stripeDefaultPaymentMethodId: null,
      bankDebitBlockedAt: at,
      bankDebitBlockedReason: "A bank payment was disputed. Autopay stays off until you clear this on the dispute page.",
    },
  });
  await db.auditLog.create({
    data: { userId: null, action: "dispute.bank_debits_blocked", entityType: "Customer", entityId: customerId, newValue: { disputeId } },
  });
}
