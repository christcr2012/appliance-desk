// BILL-1: the nightly "is the bank done yet?" check and the owner's "Record it now" recovery
// (docs/build-specs/engines/BANK-PAYMENTS-IN-FLIGHT.md sections 3 and 5).
// Stripe is asked OUTSIDE any transaction. Money is only ever recorded by replaying the same webhook handlers that
// record it today (one synthetic event with a fixed id, so it can be applied once), never by new money code here.
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { settleReferralCredits } from "@/domains/referrals";
import { processStripeWebhookEvent } from "./webhooks";
import { ensureSubscriptionIdentityForWebhook } from "./subscription-identity";
import { moneyRecordedForIntent } from "./in-flight-writers";
import type { BankPaymentClearReason } from "./in-flight";

export const BANK_CHECK_BATCH = 50;

export type BankCheckCounts = {
  checked: number;
  cleared: number;
  recovered: number;
  needsCheck: number;
  stillProcessing: number;
  errors: number;
  changedDuringCheck: number;
};

type Row = { id: string; paymentIntentId: string; stripeInvoiceId: string | null; invoiceId: string | null; startedAt: Date; settledInStripeAt: Date | null };

/** Mark a row done, but only if it is still open and still the attempt we looked at (a retry started later keeps it open). */
async function clearIfUnchanged(row: Row, reason: BankPaymentClearReason, seenAt: Date): Promise<boolean> {
  const result = await prisma.bankPaymentInFlight.updateMany({
    where: { id: row.id, clearedAt: null, startedAt: { lte: seenAt } },
    data: { clearedAt: new Date(), clearedReason: reason, clearedByEventAt: seenAt },
  });
  return result.count > 0;
}

type Replay = { event: Stripe.Event } | { notPaid: true } | { cannot: true };

/** The one event that records the payment, built from what Stripe says now. The id is fixed so it can only be applied once. */
async function buildReplayEvent(row: Row, stripe: Stripe): Promise<Replay> {
  const created = Math.floor(Date.now() / 1000);
  if (row.stripeInvoiceId) {
    const invoice = await stripe.invoices.retrieve(row.stripeInvoiceId);
    if (invoice.status !== "paid") return { notPaid: true };
    return { event: { id: `evt_bankrecover_${invoice.id}`, type: "invoice.paid", created, data: { object: invoice } } as unknown as Stripe.Event };
  }
  const sessions = await stripe.checkout.sessions.list({ payment_intent: row.paymentIntentId, limit: 1 });
  const session = sessions.data[0];
  if (!session) return { cannot: true };
  if (session.payment_status !== "paid") return { notPaid: true };
  return {
    event: { id: `evt_bankrecover_${session.id}`, type: "checkout.session.async_payment_succeeded", created, data: { object: session } } as unknown as Stripe.Event,
  };
}

export type RecoverResult = "recorded" | "already_recorded" | "not_paid" | "cannot_record" | "gone";

/**
 * "Record it now": Stripe says this bank payment cleared but our books do not have it. Re-reads Stripe, then replays the
 * normal payment handlers (which lock the bill, record once, and clear the flag). `actorUserId` null = the nightly check.
 */
export async function recoverBankSettlement(rowId: string, actorUserId: string | null, stripe: Stripe = getStripeClient()): Promise<RecoverResult> {
  const row = await prisma.bankPaymentInFlight.findUnique({
    where: { id: rowId },
    select: { id: true, paymentIntentId: true, stripeInvoiceId: true, invoiceId: true, startedAt: true, settledInStripeAt: true, clearedAt: true },
  });
  if (!row) return "gone";
  if (row.clearedAt) return "already_recorded";
  if (await moneyRecordedForIntent(prisma, row.paymentIntentId)) {
    await clearIfUnchanged(row, "SUCCEEDED", new Date());
    return "already_recorded";
  }
  const replay = await buildReplayEvent(row, stripe);
  if ("notPaid" in replay) return "not_paid";
  if ("cannot" in replay) return "cannot_record";
  await ensureSubscriptionIdentityForWebhook(replay.event); // the same first step the webhook route takes
  const result = await processStripeWebhookEvent(replay.event, {
    actorUserId,
    audit: { action: "billing.bank_payment_recovered", entityType: "BankPaymentInFlight", entityId: row.id, newValue: { paymentIntentId: row.paymentIntentId, by: actorUserId ? "owner" : "nightly check" } },
  });
  for (const referralId of result.referralIdsToSettle) await settleReferralCredits(referralId);
  const after = await prisma.bankPaymentInFlight.findUnique({ where: { id: row.id }, select: { clearedAt: true } });
  return after?.clearedAt ? "recorded" : "cannot_record";
}

/** Nightly: look at up to 50 open flags (never-checked first, then the longest-unchecked) and finish what Stripe says is finished. */
export async function checkBankPaymentsInFlight(now = new Date(), stripe: Stripe = getStripeClient(), limit = BANK_CHECK_BATCH): Promise<BankCheckCounts> {
  const counts: BankCheckCounts = { checked: 0, cleared: 0, recovered: 0, needsCheck: 0, stillProcessing: 0, errors: 0, changedDuringCheck: 0 };
  const rows = await prisma.bankPaymentInFlight.findMany({
    where: { clearedAt: null },
    select: { id: true, paymentIntentId: true, stripeInvoiceId: true, invoiceId: true, startedAt: true, settledInStripeAt: true },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { startedAt: "asc" }],
    take: limit,
  });
  for (const row of rows) {
    try {
      const seenAt = new Date();
      const intent = await stripe.paymentIntents.retrieve(row.paymentIntentId);
      counts.checked += 1;
      await prisma.bankPaymentInFlight.updateMany({ where: { id: row.id, clearedAt: null }, data: { lastCheckedAt: now } });
      if (intent.status === "succeeded") {
        if (await moneyRecordedForIntent(prisma, row.paymentIntentId)) {
          if (await clearIfUnchanged(row, "SUCCEEDED", seenAt)) counts.cleared += 1;
          else counts.changedDuringCheck += 1;
          continue;
        }
        const outcome = await recoverBankSettlement(row.id, null, stripe);
        if (outcome === "recorded") {
          counts.recovered += 1;
          continue;
        }
        if (outcome === "already_recorded" || outcome === "gone") continue;
        // Stripe says paid, our books do not have it and we could not record it: keep the flag, remember, and tell the owner.
        if (!row.settledInStripeAt) {
          await prisma.bankPaymentInFlight.updateMany({ where: { id: row.id, clearedAt: null, settledInStripeAt: null }, data: { settledInStripeAt: seenAt } });
        }
        counts.needsCheck += 1;
      } else if (intent.status === "requires_payment_method") {
        if (await clearIfUnchanged(row, "FAILED", seenAt)) counts.cleared += 1;
        else counts.changedDuringCheck += 1;
      } else if (intent.status === "canceled") {
        if (await clearIfUnchanged(row, "CANCELED", seenAt)) counts.cleared += 1;
        else counts.changedDuringCheck += 1;
      } else if (intent.status === "processing") {
        counts.stillProcessing += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error("[billing] Bank payment check failed for one payment", row.id, error instanceof Error ? error.message : error);
    }
  }
  return counts;
}
