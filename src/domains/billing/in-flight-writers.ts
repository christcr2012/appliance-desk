// BILL-1: the webhook-side writers for "Being confirmed" (docs/build-specs/engines/BANK-PAYMENTS-IN-FLIGHT.md section 2).
// Every function here runs INSIDE the locked webhook transaction (the global webhook lock is already held) and reads
// Stripe facts only from the evidence gathered before it, so no network call ever happens while a lock is held.
// A row is a flag, never money: nothing here touches a bill's totals, a payment, a receipt or the books.
import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { idOf, extractSubscriptionId, type WebhookEvidence } from "./webhook-evidence";
import type { BankPaymentClearReason, BankPaymentSource } from "./in-flight";

type Db = Prisma.TransactionClient;

/** Where an in-flight payment belongs: a local bill, or (first attempt of a subscription bill) just the rental agreement. */
type IntentTarget = {
  invoiceId: string | null;
  stripeInvoiceId: string | null;
  agreementId: string | null;
  source: BankPaymentSource;
};

function eventTime(event: Stripe.Event): Date {
  // Stripe always sends `created`; fall back to now so a hand-built event can never write an invalid date.
  return typeof event.created === "number" && Number.isFinite(event.created) ? new Date(event.created * 1000) : new Date();
}

function methodOf(intent: Pick<Stripe.PaymentIntent, "payment_method_types">): string {
  const first = intent.payment_method_types?.[0];
  return first === "us_bank_account" || !first ? "ach" : first;
}

/** The same bill lock the late-fee run holds while it checks for open rows and adds a fee (see applyLateFeeBatch). */
async function lockBill(db: Db, invoiceId: string | null): Promise<void> {
  if (!invoiceId) return;
  await db.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
}

/**
 * Is the money for this PaymentIntent already recorded? Any payment row for it counts except a failed attempt: an
 * applied payment, or one held for the owner because the bill was closed when the money arrived (the money IS recorded
 * there; the owner decides what happens to it). Never clear a flag whose money is not recorded.
 */
export async function moneyRecordedForIntent(db: Db, paymentIntentId: string): Promise<boolean> {
  const found = await db.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId, status: { not: "failed" } },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Find the bill a PaymentIntent belongs to. Returns null for payments that are not bill payments (signing payments,
 * estimate deposits, anything else): those keep their own handling and are never flagged here.
 */
async function resolveIntentTarget(
  db: Db,
  evidence: WebhookEvidence,
  intent: Pick<Stripe.PaymentIntent, "id" | "metadata">,
): Promise<IntentTarget | null> {
  const localInvoiceId = intent.metadata?.localInvoiceId;
  if (localInvoiceId) {
    const local = await db.invoice.findUnique({ where: { id: localInvoiceId }, select: { id: true } });
    return local ? { invoiceId: local.id, stripeInvoiceId: null, agreementId: null, source: "LOCAL_CHECKOUT" } : null;
  }
  const stripeInvoiceId = evidence.invoiceForIntent(intent.id);
  if (!stripeInvoiceId) return null;
  const local = await db.invoice.findUnique({ where: { stripeInvoiceId }, select: { id: true, agreementId: true } });
  if (local) return { invoiceId: local.id, stripeInvoiceId, agreementId: local.agreementId, source: "STRIPE_INVOICE" };

  // No local bill yet: only a rental subscription's bill is mirrored later (when it is paid or fails), so only that is flagged.
  const subscriptionId = extractSubscriptionId(evidence.invoice(stripeInvoiceId));
  if (!subscriptionId) return null;
  const agreement = await db.rentalAgreement.findUnique({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } });
  return agreement ? { invoiceId: null, stripeInvoiceId, agreementId: agreement.id, source: "STRIPE_INVOICE" } : null;
}

type NewRow = {
  target: IntentTarget;
  paymentIntentId: string;
  amountCents: number;
  method: string;
  startedAt: Date;
};

async function createClearedMarker(db: Db, row: NewRow, reason: BankPaymentClearReason, clearedByEventAt: Date, now: Date): Promise<void> {
  await db.bankPaymentInFlight.create({
    data: {
      invoiceId: row.target.invoiceId,
      stripeInvoiceId: row.target.stripeInvoiceId,
      agreementId: row.target.agreementId,
      source: row.target.source,
      paymentIntentId: row.paymentIntentId,
      amountCents: row.amountCents,
      method: row.method,
      startedAt: row.startedAt,
      clearedAt: now,
      clearedReason: reason,
      clearedByEventAt,
    },
  });
}

async function createOpenRow(db: Db, row: NewRow, settledInStripeAt: Date | null): Promise<string> {
  const created = await db.bankPaymentInFlight.create({
    data: {
      invoiceId: row.target.invoiceId,
      stripeInvoiceId: row.target.stripeInvoiceId,
      agreementId: row.target.agreementId,
      source: row.target.source,
      paymentIntentId: row.paymentIntentId,
      amountCents: row.amountCents,
      method: row.method,
      startedAt: row.startedAt,
      settledInStripeAt,
    },
    select: { id: true },
  });
  await db.auditLog.create({
    data: {
      userId: null,
      action: "billing.bank_payment_in_flight",
      entityType: row.target.invoiceId ? "Invoice" : "RentalAgreement",
      entityId: (row.target.invoiceId ?? row.target.agreementId) as string,
      newValue: {
        paymentIntentId: row.paymentIntentId,
        amountCents: row.amountCents,
        source: row.target.source,
        ...(settledInStripeAt ? { stripeSaysCleared: true } : {}),
      },
    },
  });
  return created.id;
}

/**
 * Open (or record already-ended) the flag for a PaymentIntent that is not known yet, using Stripe's state NOW:
 * processing → open; requires_payment_method / canceled → recorded already cleared; succeeded → cleared when the money
 * is recorded, otherwise open with `settledInStripeAt` (the settlement webhook may have been missed — a row whose money
 * is not recorded is never cleared); any other state (e.g. waiting for the customer to verify their bank) → nothing.
 */
async function openFromCurrentIntent(
  db: Db,
  evidence: WebhookEvidence,
  row: NewRow,
  now: Date,
): Promise<void> {
  const current = evidence.paymentIntentWithMethod(row.paymentIntentId);
  switch (current.status) {
    case "processing":
      await createOpenRow(db, row, null);
      return;
    case "requires_payment_method":
      await createClearedMarker(db, row, "FAILED", row.startedAt, now);
      return;
    case "canceled":
      await createClearedMarker(db, row, "CANCELED", row.startedAt, now);
      return;
    case "succeeded":
      if (await moneyRecordedForIntent(db, row.paymentIntentId)) {
        await createClearedMarker(db, row, "SUCCEEDED", row.startedAt, now);
      } else {
        await createOpenRow(db, row, now);
      }
      return;
    default:
      return;
  }
}

/** `payment_intent.processing`: the bank is confirming a payment. */
export async function handlePaymentIntentProcessing(db: Db, evidence: WebhookEvidence, event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const at = eventTime(event);
  const now = new Date();

  const existing = await db.bankPaymentInFlight.findUnique({ where: { paymentIntentId: intent.id } });
  if (existing) {
    if (!existing.clearedAt) return; // already open (a different event for the same intent): one row per intent, ever
    // Only a FAILED row can reopen, and only for a genuine retry: a newer event than the failure AND Stripe says processing now.
    // Anything else (a stale or reordered event, a CANCELED / SUCCEEDED / INVOICE_CLOSED row) stays cleared.
    if (existing.clearedReason !== "FAILED" || !existing.clearedByEventAt || at <= existing.clearedByEventAt) return;
    if (evidence.paymentIntentWithMethod(intent.id).status !== "processing") return;
    await lockBill(db, existing.invoiceId);
    const reopened = await db.bankPaymentInFlight.updateMany({
      where: { id: existing.id, clearedAt: { not: null }, clearedReason: "FAILED" },
      data: {
        clearedAt: null, clearedReason: null, clearedByEventAt: null, startedAt: at,
        attempt: existing.attempt + 1, lastCheckedAt: null, settledInStripeAt: null,
      },
    });
    if (reopened.count === 1) {
      await db.auditLog.create({
        data: {
          userId: null,
          action: "billing.bank_payment_retry",
          entityType: existing.invoiceId ? "Invoice" : "RentalAgreement",
          entityId: (existing.invoiceId ?? existing.agreementId) as string,
          newValue: { paymentIntentId: intent.id, attempt: existing.attempt + 1 },
        },
      });
    }
    return;
  }

  // The money is already recorded for this intent: it is not "being confirmed" any more.
  if (await moneyRecordedForIntent(db, intent.id)) return;
  const target = await resolveIntentTarget(db, evidence, intent);
  if (!target) return;
  await lockBill(db, target.invoiceId);
  await openFromCurrentIntent(db, evidence, {
    target, paymentIntentId: intent.id, amountCents: intent.amount, method: methodOf(intent), startedAt: at,
  }, now);
}

/** `payment_intent.payment_failed` / `payment_intent.canceled`: the bank payment did not go through. */
export async function handlePaymentIntentEnded(
  db: Db,
  evidence: WebhookEvidence,
  event: Stripe.Event,
  reason: "FAILED" | "CANCELED",
): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const at = eventTime(event);
  const now = new Date();

  const row = await db.bankPaymentInFlight.findUnique({ where: { paymentIntentId: intent.id } });
  if (row) {
    if (row.clearedAt) return;
    if (at < row.startedAt) {
      // A failure from an earlier attempt, delivered late: the current attempt is still being confirmed.
      await db.auditLog.create({
        data: {
          userId: null,
          action: "billing.bank_payment_stale_event",
          entityType: row.invoiceId ? "Invoice" : "RentalAgreement",
          entityId: (row.invoiceId ?? row.agreementId) as string,
          newValue: { paymentIntentId: intent.id, eventType: event.type, attempt: row.attempt },
        },
      });
      return;
    }
    await db.bankPaymentInFlight.updateMany({
      where: { id: row.id, clearedAt: null },
      data: { clearedAt: now, clearedReason: reason, clearedByEventAt: at },
    });
    return;
  }

  // No row yet: write one already cleared, so an OLDER "processing" event that arrives late cannot open it again.
  const target = await resolveIntentTarget(db, evidence, intent);
  if (!target) return;
  await createClearedMarker(db, {
    target, paymentIntentId: intent.id, amountCents: intent.amount, method: methodOf(intent), startedAt: at,
  }, reason, at, now);
}

/** `checkout.session.completed` for a shop sale whose bank payment is not paid yet. */
export async function onLocalCheckoutUnpaid(db: Db, evidence: WebhookEvidence, session: Stripe.Checkout.Session, event: Stripe.Event): Promise<void> {
  const paymentIntentId = idOf(session.payment_intent);
  const invoiceId = session.metadata?.localInvoiceId;
  if (!paymentIntentId || !invoiceId || session.payment_status !== "unpaid") return;
  if (await db.bankPaymentInFlight.findUnique({ where: { paymentIntentId }, select: { id: true } })) return;
  if (await moneyRecordedForIntent(db, paymentIntentId)) return;
  const amount = session.amount_total;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) return;
  const target = await resolveIntentTarget(db, evidence, { id: paymentIntentId, metadata: { localInvoiceId: invoiceId } as Stripe.Metadata });
  if (!target) return;
  await lockBill(db, target.invoiceId);
  const intent = evidence.paymentIntentWithMethod(paymentIntentId);
  await openFromCurrentIntent(db, evidence, {
    target, paymentIntentId, amountCents: amount as number, method: methodOf(intent), startedAt: eventTime(event),
  }, new Date());
}

/** `checkout.session.async_payment_succeeded` / `_failed` for a shop sale: the bank has answered. */
export async function onLocalCheckoutAsyncResult(
  db: Db,
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  reason: "SUCCEEDED" | "FAILED",
): Promise<void> {
  const paymentIntentId = idOf(session.payment_intent);
  const invoiceId = session.metadata?.localInvoiceId;
  if (!paymentIntentId || !invoiceId) return;
  const at = eventTime(event);
  const now = new Date();
  const row = await db.bankPaymentInFlight.findUnique({ where: { paymentIntentId } });
  if (row) {
    if (row.clearedAt) return;
    // A success answer clears the row only after the money is recorded (the handler that ran just before this one records it).
    if (reason === "SUCCEEDED" && !(await moneyRecordedForIntent(db, paymentIntentId))) return;
    await db.bankPaymentInFlight.updateMany({
      where: { id: row.id, clearedAt: null },
      data: { clearedAt: now, clearedReason: reason, clearedByEventAt: at },
    });
    return;
  }
  const exists = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
  const amount = session.amount_total;
  if (!exists || !Number.isSafeInteger(amount) || (amount as number) <= 0) return;
  // Already answered before the "unpaid" completion arrived: write it cleared so the late completion cannot open it.
  await createClearedMarker(db, {
    target: { invoiceId, stripeInvoiceId: null, agreementId: null, source: "LOCAL_CHECKOUT" },
    paymentIntentId, amountCents: amount as number, method: "ach", startedAt: at,
  }, reason, at, now);
}

/** Wherever a local bill is created or found for a Stripe invoice: attach any flag that was waiting for it. */
export async function attachInFlightRowsToBill(db: Db, stripeInvoiceId: string | null | undefined, invoiceId: string): Promise<void> {
  if (!stripeInvoiceId) return;
  await db.bankPaymentInFlight.updateMany({ where: { stripeInvoiceId, invoiceId: null }, data: { invoiceId } });
}

/** `invoice.paid`: the money is recorded, so every open flag on this bill is done. */
export async function clearRowsForPaidInvoice(db: Db, stripeInvoiceId: string, invoiceId: string | null, event: Stripe.Event): Promise<void> {
  await db.bankPaymentInFlight.updateMany({
    where: { clearedAt: null, OR: [{ stripeInvoiceId }, ...(invoiceId ? [{ invoiceId }] : [])] },
    data: { clearedAt: new Date(), clearedReason: "SUCCEEDED", clearedByEventAt: eventTime(event) },
  });
}

/**
 * `invoice.payment_failed`: clear the flag for the latest failed intent, but only when this event belongs to the
 * CURRENT attempt (`event.created >= row.startedAt`). A failure from an earlier attempt delivered late changes nothing.
 */
export async function clearRowForFailedInvoice(db: Db, paymentIntentId: string | null, event: Stripe.Event): Promise<void> {
  if (!paymentIntentId) return;
  const at = eventTime(event);
  await db.bankPaymentInFlight.updateMany({
    where: { paymentIntentId, clearedAt: null, startedAt: { lte: at } },
    data: { clearedAt: new Date(), clearedReason: "FAILED", clearedByEventAt: at },
  });
}
