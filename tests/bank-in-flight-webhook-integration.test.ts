import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// BILL-1 on real Postgres with a FAKE Stripe: the webhook side of "Being confirmed" (spec section 2).
// Covers AI-PR-READ-FIRST item 1 (duplicate delivery), item 2 (delayed bank settlement) and out-of-order delivery.
const m = vi.hoisted(() => ({
  intents: new Map<string, { status: string; types?: string[] }>(),
  invoiceByIntent: new Map<string, string>(),
  invoices: new Map<string, unknown>(),
  invoicePaymentsList: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    paymentIntents: {
      retrieve: async (id: string) => {
        const state = m.intents.get(id) ?? { status: "processing" };
        return {
          id, status: state.status, payment_method_types: state.types ?? ["us_bank_account"],
          payment_method: { id: `pm_${id}`, type: "us_bank_account" }, latest_charge: null,
        };
      },
    },
    invoicePayments: {
      list: async (params: { payment: { payment_intent: string } }) => {
        m.invoicePaymentsList(params);
        const invoice = m.invoiceByIntent.get(params.payment.payment_intent);
        return { data: invoice ? [{ invoice }] : [] };
      },
    },
    invoices: { retrieve: async (id: string) => m.invoices.get(id) },
    subscriptions: { retrieve: async () => ({}) },
    charges: { retrieve: async () => ({}) },
  }),
}));

import { prisma } from "@/lib/prisma";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { ensureSubscriptionIdentityForWebhook } from "@/domains/billing/subscription-identity";
import { inFlightWhere, notInFlightWhere } from "@/domains/billing/in-flight";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

/** The same steps the real webhook route takes for every event. */
async function deliver(event: Stripe.Event) {
  await ensureSubscriptionIdentityForWebhook(event);
  return processStripeWebhookEvent(event);
}

const NOW = Math.floor(Date.now() / 1000);

describe.skipIf(!enabled)("bank payments being confirmed — webhook side (real Postgres, fake Stripe)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const userId = `bf-user-${tag}`;
  const customerId = `bf-customer-${tag}`;
  const addressId = `bf-address-${tag}`;
  const agreements: string[] = [];
  const invoices: string[] = [];
  const events: string[] = [];
  let n = 0;
  const next = (prefix: string) => `${prefix}_${tag}_${n++}`;

  function event(type: string, object: unknown, created = NOW): Stripe.Event {
    const id = `evt_${randomUUID()}`;
    events.push(id);
    return { id, type, created, data: { object } } as unknown as Stripe.Event;
  }

  async function makeAgreement() {
    const id = next("bf-agreement");
    agreements.push(id);
    const subscription = next("sub");
    await prisma.rentalAgreement.create({
      data: { id, customerId, serviceAddressId: addressId, status: "ACTIVE", stripeSubscriptionId: subscription },
    });
    return { id, subscription };
  }

  /** A subscription bill that exists locally as OPEN (the usual case once Stripe has finalized it). */
  async function makeStripeBill(agreement: { id: string; subscription: string }, paid = false) {
    const stripeInvoiceId = next("in");
    const invoice = {
      id: stripeInvoiceId, status: paid ? "paid" : "open", amount_due: 4000, amount_paid: paid ? 4000 : 0, subtotal: 4000,
      parent: { subscription_details: { subscription: agreement.subscription } }, total_taxes: [],
      lines: { data: [{ description: "Washer", amount: 4000 }] },
      payments: { data: [{ payment: { payment_intent: `pi_paid_${stripeInvoiceId}` }, amount_paid: 4000, status: "paid" }], has_more: false },
    };
    m.invoices.set(stripeInvoiceId, invoice);
    return invoice;
  }
  async function localBill(agreement: { id: string }, stripeInvoiceId: string, dueDate: Date | null = null) {
    const id = next("bf-inv");
    invoices.push(id);
    await prisma.invoice.create({
      data: { id, customerId, agreementId: agreement.id, status: "OPEN", subtotalCents: 4000, amountDueCents: 4000, stripeInvoiceId, dueDate },
    });
    return id;
  }
  async function shopSale() {
    const id = next("bf-sale");
    invoices.push(id);
    await prisma.invoice.create({
      data: { id, customerId, status: "OPEN", subtotalCents: 5000, amountDueCents: 5000, saleKind: "SHOP_SALE", saleLocation: "PICKUP" },
    });
    return id;
  }

  const intent = (id: string, extra: Partial<Stripe.PaymentIntent> = {}) =>
    ({ id, object: "payment_intent", amount: 4000, currency: "usd", payment_method_types: ["us_bank_account"], metadata: {}, ...extra }) as Stripe.PaymentIntent;
  const rowsFor = (pi: string) => prisma.bankPaymentInFlight.findMany({ where: { paymentIntentId: pi } });
  const oneRow = async (pi: string) => {
    const rows = await rowsFor(pi);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };

  beforeEach(() => {
    m.intents.clear();
    m.invoiceByIntent.clear();
    m.invoicePaymentsList.mockClear();
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "In-flight fixture", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `F${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "100 Test St", city: "Denver", zip: "80201" } });
  });

  afterAll(async () => {
    const all = await prisma.invoice.findMany({ where: { customerId }, select: { id: true } });
    const ids = all.map((row) => row.id);
    await prisma.bankPaymentInFlight.deleteMany({ where: { OR: [{ invoiceId: { in: ids } }, { agreementId: { in: agreements } }] } });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.deposit.deleteMany({ where: { agreementId: { in: agreements } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...agreements] } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreements } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
  });

  it("processing creates one open row for the bill; the same event twice, and a different event for the same intent, still make one", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);

    const first = event("payment_intent.processing", intent(pi));
    await deliver(first);
    await deliver(first); // Stripe delivers at least once: the event id is deduped
    await deliver(event("payment_intent.processing", intent(pi))); // a different event, same intent: unique intent id

    const row = await oneRow(pi);
    expect(row).toMatchObject({ invoiceId: billId, stripeInvoiceId: bill.id, source: "STRIPE_INVOICE", amountCents: 4000, method: "ach", attempt: 1, clearedAt: null });
    expect(await prisma.invoice.count({ where: { AND: [{ id: billId }, inFlightWhere] } })).toBe(1);
    expect(await prisma.invoice.count({ where: { AND: [{ id: billId }, notInFlightWhere] } })).toBe(0);
  });

  it("a processing bank payment changes no money: the bill, payments and receipts are exactly as before", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    const billId = await localBill(agreement, bill.id);
    const snapshot = async () => ({
      invoice: await prisma.invoice.findUniqueOrThrow({ where: { id: billId }, select: { status: true, amountDueCents: true, amountPaidCents: true, lateFeeCents: true } }),
      payments: await prisma.payment.count({ where: { invoiceId: billId } }),
      receipts: await prisma.receipt.count({ where: { customerId } }),
      lines: await prisma.invoiceLineItem.count({ where: { invoiceId: billId } }),
    });
    const before = await snapshot();
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi)));
    expect((await oneRow(pi)).clearedAt).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it("invoice.paid records the money and clears the row (SUCCEEDED)", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement, true);
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi)));
    expect((await oneRow(pi)).clearedAt).toBeNull();

    await deliver(event("invoice.paid", bill));
    const row = await oneRow(pi);
    expect(row.clearedReason).toBe("SUCCEEDED");
    expect(row.clearedAt).not.toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: billId } })).status).toBe("PAID");
  });

  it("payment_failed clears it (FAILED) and the bill is not in flight any more", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi), NOW));
    await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 5));
    const row = await oneRow(pi);
    expect(row.clearedReason).toBe("FAILED");
    expect(await prisma.invoice.count({ where: { AND: [{ id: billId }, notInFlightWhere] } })).toBe(1);
  });

  it("payment_intent.canceled clears it (CANCELED), which is final: a later processing event never reopens it", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi), NOW));
    await deliver(event("payment_intent.canceled", intent(pi), NOW + 5));
    expect((await oneRow(pi)).clearedReason).toBe("CANCELED");
    await deliver(event("payment_intent.processing", intent(pi), NOW + 50));
    expect((await oneRow(pi)).clearedAt).not.toBeNull();
  });

  it("out of order: a failure before processing leaves no open row, and the older processing event cannot open it", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "requires_payment_method" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 10));
    const marker = await oneRow(pi);
    expect(marker).toMatchObject({ clearedReason: "FAILED" });
    expect(marker.clearedAt).not.toBeNull();
    await deliver(event("payment_intent.processing", intent(pi), NOW)); // older than the failure, delivered late
    expect((await oneRow(pi)).clearedAt).not.toBeNull();
    expect(await prisma.bankPaymentInFlight.count({ where: { paymentIntentId: pi, clearedAt: null } })).toBe(0);
  });

  it("out of order: the money recorded before the processing event leaves no open row", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement, true);
    const billId = await localBill(agreement, bill.id);
    await deliver(event("invoice.paid", bill)); // records a payment for pi_paid_<invoice>
    const pi = `pi_paid_${bill.id}`;
    m.intents.set(pi, { status: "succeeded" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi), NOW - 100));
    expect(await rowsFor(pi)).toHaveLength(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: billId } })).status).toBe("PAID");
  });

  it("an intent that pays no bill (another kind of payment) changes nothing", async () => {
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    await deliver(event("payment_intent.processing", intent(pi)));
    await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 3));
    expect(await rowsFor(pi)).toHaveLength(0);
  });

  it("a not-yet-mirrored subscription bill: the row waits on the rental agreement, then invoice.paid creates the bill, attaches the row and clears it", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement, true);
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi)));
    const waiting = await oneRow(pi);
    expect(waiting).toMatchObject({ invoiceId: null, agreementId: agreement.id, stripeInvoiceId: bill.id, clearedAt: null });

    await deliver(event("invoice.paid", bill));
    const bill2 = await prisma.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: bill.id } });
    invoices.push(bill2.id);
    const done = await oneRow(pi);
    expect(done).toMatchObject({ invoiceId: bill2.id, clearedReason: "SUCCEEDED" });
    expect(done.clearedAt).not.toBeNull();
  });

  it("a not-yet-mirrored subscription bill: invoice.payment_failed creates the bill, attaches the row and clears it (FAILED)", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    const pi = `pi_paid_${bill.id}`; // the invoice's own payment attempt
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, bill.id);
    await deliver(event("payment_intent.processing", intent(pi), NOW));
    expect((await oneRow(pi)).invoiceId).toBeNull();

    await deliver(event("invoice.payment_failed", { ...bill, status: "open" }, NOW + 20));
    const created = await prisma.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: bill.id } });
    invoices.push(created.id);
    const row = await oneRow(pi);
    expect(row).toMatchObject({ invoiceId: created.id, clearedReason: "FAILED" });
  });

  it("a payment for something that is not a rental subscription bill is never flagged", async () => {
    const stripeInvoiceId = next("in_other");
    m.invoices.set(stripeInvoiceId, { id: stripeInvoiceId, status: "open", parent: null, lines: { data: [] }, payments: { data: [], has_more: false } });
    const pi = next("pi");
    m.intents.set(pi, { status: "processing" });
    m.invoiceByIntent.set(pi, stripeInvoiceId);
    await deliver(event("payment_intent.processing", intent(pi)));
    expect(await rowsFor(pi)).toHaveLength(0);
  });

  it("a retried bank payment: a genuine retry reopens (attempt 2); a stale or already-failed-again event does not", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.invoiceByIntent.set(pi, bill.id);
    m.intents.set(pi, { status: "processing" });
    await deliver(event("payment_intent.processing", intent(pi), NOW));
    await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 100));
    expect((await oneRow(pi)).clearedReason).toBe("FAILED");

    // stale: an old processing event, delivered late
    await deliver(event("payment_intent.processing", intent(pi), NOW + 50));
    expect((await oneRow(pi)).clearedAt).not.toBeNull();

    // newer than the failure, but Stripe now says it needs a new payment method: stays cleared
    m.intents.set(pi, { status: "requires_payment_method" });
    await deliver(event("payment_intent.processing", intent(pi), NOW + 200));
    expect((await oneRow(pi)).clearedAt).not.toBeNull();

    // a genuine retry: newer event and Stripe says processing now
    m.intents.set(pi, { status: "processing" });
    await deliver(event("payment_intent.processing", intent(pi), NOW + 300));
    const reopened = await oneRow(pi);
    expect(reopened).toMatchObject({ attempt: 2, clearedAt: null, clearedReason: null, clearedByEventAt: null, lastCheckedAt: null });
    expect(reopened.startedAt.getTime()).toBe((NOW + 300) * 1000);
    expect(await prisma.invoice.count({ where: { AND: [{ id: billId }, inFlightWhere] } })).toBe(1);
  });

  it("regression: attempt 1's late failure messages never close attempt 2", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    await localBill(agreement, bill.id);
    const pi = `pi_paid_${bill.id}`;
    m.invoiceByIntent.set(pi, bill.id);
    m.intents.set(pi, { status: "processing" });
    await deliver(event("payment_intent.processing", intent(pi), NOW));
    await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 100)); // attempt 1 fails
    await deliver(event("payment_intent.processing", intent(pi), NOW + 300)); // attempt 2
    expect((await oneRow(pi)).attempt).toBe(2);

    const staleBefore = await prisma.auditLog.count({ where: { action: "billing.bank_payment_stale_event" } });
    await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 100)); // attempt 1's failure, delivered again later
    await deliver(event("invoice.payment_failed", { ...bill, status: "open" }, NOW + 100));
    const row = await oneRow(pi);
    expect(row.clearedAt).toBeNull();
    // The older failure is recorded as a stale event, not applied.
    expect(await prisma.auditLog.count({ where: { action: "billing.bank_payment_stale_event" } })).toBe(staleBefore + 1);
  });

  it("Stripe says the payment succeeded but no money is recorded (the settlement message was missed): the row opens with settledInStripeAt", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.invoiceByIntent.set(pi, bill.id);
    m.intents.set(pi, { status: "succeeded" });
    await deliver(event("payment_intent.processing", intent(pi)));
    const row = await oneRow(pi);
    expect(row.clearedAt).toBeNull();
    expect(row.settledInStripeAt).not.toBeNull();
    expect(await prisma.invoice.count({ where: { AND: [{ id: billId }, inFlightWhere] } })).toBe(1);
  });

  it("the evidence refill path works: a missing lookup is fetched and the event is replayed", async () => {
    const agreement = await makeAgreement();
    const bill = await makeStripeBill(agreement);
    await localBill(agreement, bill.id);
    const pi = next("pi");
    m.invoiceByIntent.set(pi, bill.id);
    // At gather time a row "exists" (so no lookup is gathered); inside the lock it does not: the handler asks for the lookup.
    const original = prisma.bankPaymentInFlight.findUnique.bind(prisma.bankPaymentInFlight);
    let calls = 0;
    const spy = vi.spyOn(prisma.bankPaymentInFlight, "findUnique").mockImplementation(((args: unknown) => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ id: "pretend" }) as never;
      return original(args as never) as never;
    }) as never);
    try {
      await deliver(event("payment_intent.payment_failed", intent(pi), NOW + 5));
    } finally {
      spy.mockRestore();
    }
    expect(m.invoicePaymentsList).toHaveBeenCalledTimes(1);
    expect((await oneRow(pi)).clearedReason).toBe("FAILED");
  });

  describe("shop sale paid by bank on Stripe's page", () => {
    const session = (invoiceId: string, pi: string, status: "paid" | "unpaid", extra: Record<string, unknown> = {}) => ({
      id: next("cs"), object: "checkout.session", mode: "payment", payment_status: status, payment_intent: pi, amount_total: 5000, currency: "usd",
      metadata: { localInvoiceId: invoiceId, localInvoiceCustomerId: customerId }, ...extra,
    });

    it("an unpaid completion opens the row; the async success records the money and clears it", async () => {
      const saleId = await shopSale();
      const pi = next("pi");
      m.intents.set(pi, { status: "processing" });
      await deliver(event("checkout.session.completed", session(saleId, pi, "unpaid"), NOW));
      expect(await oneRow(pi)).toMatchObject({ invoiceId: saleId, source: "LOCAL_CHECKOUT", amountCents: 5000, method: "ach", clearedAt: null });

      m.intents.set(pi, { status: "succeeded" });
      await deliver(event("checkout.session.async_payment_succeeded", session(saleId, pi, "paid"), NOW + 60));
      const row = await oneRow(pi);
      expect(row.clearedReason).toBe("SUCCEEDED");
      expect(await prisma.payment.count({ where: { invoiceId: saleId, stripePaymentIntentId: pi } })).toBe(1);
    });

    it("the async failure clears it (FAILED) and records no money", async () => {
      const saleId = await shopSale();
      const pi = next("pi");
      m.intents.set(pi, { status: "processing" });
      await deliver(event("checkout.session.completed", session(saleId, pi, "unpaid"), NOW));
      await deliver(event("checkout.session.async_payment_failed", session(saleId, pi, "unpaid"), NOW + 60));
      expect((await oneRow(pi)).clearedReason).toBe("FAILED");
      expect(await prisma.payment.count({ where: { invoiceId: saleId } })).toBe(0);
    });

    it("out of order: the async failure arrives before the unpaid completion, so no open row appears", async () => {
      const saleId = await shopSale();
      const pi = next("pi");
      m.intents.set(pi, { status: "requires_payment_method" });
      await deliver(event("checkout.session.async_payment_failed", session(saleId, pi, "unpaid"), NOW + 60));
      await deliver(event("checkout.session.completed", session(saleId, pi, "unpaid"), NOW));
      expect(await prisma.bankPaymentInFlight.count({ where: { paymentIntentId: pi, clearedAt: null } })).toBe(0);
      expect((await oneRow(pi)).clearedReason).toBe("FAILED");
    });

    it("out of order: the async success (money recorded) arrives before the unpaid completion, so no open row appears", async () => {
      const saleId = await shopSale();
      const pi = next("pi");
      m.intents.set(pi, { status: "succeeded" });
      await deliver(event("checkout.session.async_payment_succeeded", session(saleId, pi, "paid"), NOW + 60));
      await deliver(event("checkout.session.completed", session(saleId, pi, "unpaid"), NOW));
      expect(await prisma.bankPaymentInFlight.count({ where: { paymentIntentId: pi, clearedAt: null } })).toBe(0);
      expect(await prisma.payment.count({ where: { invoiceId: saleId, stripePaymentIntentId: pi } })).toBe(1);
    });

    it("a card payment (paid at once) never creates a row", async () => {
      const saleId = await shopSale();
      const pi = next("pi");
      m.intents.set(pi, { status: "succeeded", types: ["card"] });
      await deliver(event("checkout.session.completed", session(saleId, pi, "paid"), NOW));
      expect(await rowsFor(pi)).toHaveLength(0);
    });
  });
});
