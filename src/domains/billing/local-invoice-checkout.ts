import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getStripeClient } from "@/lib/stripe";
import { ensureStripeCustomer } from "./checkout";
import {
  attachProviderIdsToReceiptPayments,
  createReceiptWithAllocations,
  holdReceiptForClosedInvoice,
  lockCustomerLedger,
} from "./ledger";
import { idOf, type WebhookEvidence } from "./webhook-evidence";

/**
 * Batch M, M-3. "Pay by card" for a shop sale (a local invoice with no Stripe invoice).
 *
 * Creating the page: the customer pays on Stripe's own hosted page (nothing about the card passes through this app).
 * The page is created for exactly what is still owed. Asking again for the same amount returns the same page (Stripe's
 * idempotency key is `local-invoice-checkout-<invoice>-<cents>-<where from>`); a different amount makes a new page.
 * Creating a payment page moves no money, so no database record of it is needed beyond an audit row.
 *
 * Recording the money (webhook): only when Stripe says the session is paid. The receipt is recorded once per Stripe
 * charge and once per payment intent, however many times Stripe repeats the event. If the sale was cancelled, written
 * off or already paid by the time the money arrives, the money is held for the owner (a "held payment" the owner can
 * send back to the card, mark as paid or turn into credit); if it is more than what is still owed, the extra becomes
 * account credit. Money is never dropped and never applied twice.
 */
export class LocalInvoiceCheckoutError extends Error {}

const PAYABLE = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"];
const MAX_CARD_CENTS = 5_000_000;

export type LocalCheckoutActor = { kind: "desk"; userId: string } | { kind: "portal"; userId: string };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function createLocalInvoiceCheckout(actor: LocalCheckoutActor, invoiceId: string): Promise<{ url: string; amountCents: number }> {
  let customerFilter: string | null = null;
  if (actor.kind === "desk") {
    await prisma.$transaction((tx) => assertActiveTeamActor(tx, actor.userId, ["OWNER", "ADMIN"]));
  } else {
    const customer = await prisma.customer.findUnique({ where: { userId: actor.userId }, select: { id: true, archivedAt: true, isWalkIn: true } });
    if (!customer || customer.archivedAt || customer.isWalkIn) throw new LocalInvoiceCheckoutError("We couldn't find that bill.");
    customerFilter = customer.id;
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...(customerFilter ? { customerId: customerFilter } : {}) },
    select: {
      id: true, invoiceNumber: true, status: true, saleKind: true, stripeInvoiceId: true, amountDueCents: true, amountPaidCents: true, customerId: true,
      customer: { select: { isWalkIn: true } },
    },
  });
  if (!invoice) throw new LocalInvoiceCheckoutError(actor.kind === "portal" ? "We couldn't find that bill." : "Couldn't find that sale.");
  if (invoice.saleKind !== "SHOP_SALE" || invoice.stripeInvoiceId) throw new LocalInvoiceCheckoutError("Card payment is only available for shop sales.");
  if (!PAYABLE.includes(invoice.status)) throw new LocalInvoiceCheckoutError("This sale is paid or closed, so there is nothing to collect.");
  const owed = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  if (owed <= 0) throw new LocalInvoiceCheckoutError("Nothing is owed on this sale.");
  if (owed > MAX_CARD_CENTS) throw new LocalInvoiceCheckoutError("This amount is too large to take by card here. Record the payment another way.");

  const stripeCustomerId = invoice.customer.isWalkIn ? null : await ensureStripeCustomer(invoice.customerId);
  const base = appUrl();
  const back = actor.kind === "desk" ? `${base}/desk/sales/${invoice.id}` : `${base}/account/billing/invoice/${invoice.id}`;
  const key = `local-invoice-checkout-${invoice.id}-${owed}-${actor.kind}`;
  const session = await getStripeClient().checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: owed, product_data: { name: `Sale #${invoice.invoiceNumber}` } } }],
      success_url: `${back}?card=paid`,
      cancel_url: `${back}?card=cancelled`,
      payment_intent_data: { metadata: { localInvoiceId: invoice.id } },
      metadata: { localInvoiceId: invoice.id, localInvoiceCustomerId: invoice.customerId, localInvoiceOperationKey: key },
    },
    { idempotencyKey: key },
  );
  if (!session.url) throw new LocalInvoiceCheckoutError("Stripe didn't return a payment page. Nothing was charged. Please try again.");
  await prisma.auditLog.create({
    data: { userId: actor.userId, action: "sale.card_page_created", entityType: "Invoice", entityId: invoice.id, newValue: { amountCents: owed, sessionId: session.id, from: actor.kind } },
  });
  return { url: session.url, amountCents: owed };
}

/** True when this Checkout session belongs to a shop sale (so the generic handlers must leave it alone). */
export function isLocalInvoiceSession(session: Stripe.Checkout.Session): boolean {
  return Boolean(session.metadata?.localInvoiceId);
}

/**
 * Record the money for a PAID session (called from the locked webhook transaction). Safe to call again for the same
 * event, charge or payment intent.
 */
export async function recordLocalInvoiceCheckoutPayment(
  db: Prisma.TransactionClient,
  evidence: WebhookEvidence,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const invoiceId = session.metadata!.localInvoiceId!;
  const paymentIntentId = idOf(session.payment_intent);
  if (!paymentIntentId) return;
  if (session.payment_status !== "paid") return;
  const amountCents = session.amount_total;
  if (!Number.isSafeInteger(amountCents) || (amountCents as number) <= 0 || session.currency !== "usd") {
    throw new Error("Stripe reported an unusable amount for a shop sale payment.");
  }
  const paidCents = amountCents as number;

  const found = await db.invoice.findUnique({ where: { id: invoiceId }, select: { customerId: true, saleKind: true } });
  if (!found || found.saleKind !== "SHOP_SALE") throw new Error("A card payment named a sale that does not exist here.");
  if (session.metadata?.localInvoiceCustomerId && session.metadata.localInvoiceCustomerId !== found.customerId) {
    throw new Error("A card payment's customer does not match the sale it named.");
  }
  await lockCustomerLedger(db, found.customerId);

  // Already recorded for this payment (a repeated event, or the later "async payment succeeded" for the same money).
  const already = await db.payment.findFirst({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } });
  if (already) return;

  const rows = await db.$queryRaw<Array<{ status: string; amountDueCents: number; amountPaidCents: number }>>`
    SELECT "status", "amountDueCents", "amountPaidCents" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
  const invoice = rows[0];
  if (!invoice) throw new Error("A card payment named a sale that does not exist here.");
  const owed = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  const details = evidence.paymentDetails(paymentIntentId);
  const method = details.method ?? "card";

  if (!PAYABLE.includes(invoice.status) || owed <= 0) {
    await holdReceiptForClosedInvoice(db, {
      customerId: found.customerId, invoiceId, amountCents: paidCents, method, receivedOn: details.receivedOn,
      stripeChargeId: details.stripeChargeId, stripePaymentIntentId: paymentIntentId,
    });
    await db.auditLog.create({
      data: {
        userId: null, action: "billing.payment_on_closed_invoice", entityType: "Invoice", entityId: invoiceId,
        newValue: { invoiceStatus: invoice.status, receivedCents: paidCents, handling: "Held for the owner: the sale was already paid or closed when the card payment arrived. Review and decide." },
      },
    });
    return;
  }

  const applied = Math.min(owed, paidCents);
  const { receiptId } = await createReceiptWithAllocations(db, {
    customerId: found.customerId, source: "STRIPE", amountCents: paidCents, method, receivedOn: details.receivedOn,
    stripeChargeId: details.stripeChargeId ?? undefined,
    allocations: [{ invoiceId, amountCents: applied }],
  });
  await attachProviderIdsToReceiptPayments(db, { receiptId, stripePaymentIntentId: paymentIntentId, stripeChargeId: details.stripeChargeId });
  await db.auditLog.create({
    data: {
      userId: null, action: "sale.card_payment_recorded", entityType: "Invoice", entityId: invoiceId,
      newValue: { receiptId, paidCents, appliedCents: applied, extraCreditCents: paidCents - applied, sessionId: session.id },
    },
  });
}

export async function recordLocalInvoiceCheckoutFailure(db: Prisma.TransactionClient, session: Stripe.Checkout.Session): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: null, action: "sale.card_payment_failed", entityType: "Invoice", entityId: session.metadata!.localInvoiceId!,
      newValue: { reason: "The customer's bank payment for this sale failed to clear. Nothing was recorded as paid.", sessionId: session.id },
    },
  });
}
