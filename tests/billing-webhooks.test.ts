import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";

// ---------------------------------------------------------------------------
// Real, database-backed (same pattern as tests/customer-isolation.test.ts —
// see its own comment for why this can't run/verify locally in this
// sandbox, only in CI's real throwaway Postgres). Stripe's own API is
// faked via __setStripeClientForTests rather than mocking @/lib/prisma:
// the whole point of this suite is proving the webhook handlers' actual
// database writes (idempotency, correct Invoice/Payment/Deposit creation,
// correctly advancing nextBillingDate) are right, which only a real
// database can prove.
// ---------------------------------------------------------------------------

const RUN_ID = Math.random().toString(36).slice(2, 10);

let applianceTypeId: string;
let userId: string;
let customerId: string;
let serviceAddressId: string;
let agreementId: string;
let lineId: string;
// Declared here (not inside beforeAll) so individual tests can mutate an
// entry in place — e.g. simulating the same Stripe invoice id going from
// "payment failed" to "payment succeeded on retry" the way a real one
// would, or a delayed-settlement (ACH) invoice moving from "open" to
// "paid" once the bank transfer actually clears.
let fakeInvoicesById: Record<string, Record<string, unknown>>;

function fakeEvent(id: string, type: string, object: unknown): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

beforeAll(async () => {
  const applianceType = await prisma.applianceType.create({
    data: {
      name: `Billing Test Type ${RUN_ID}`,
      slug: `billing-test-type-${RUN_ID}`,
      monthlyPriceCents: 5000,
    },
  });
  applianceTypeId = applianceType.id;

  const user = await prisma.user.create({
    data: {
      email: `billing-test-${RUN_ID}@example.test`,
      name: "Billing Test Customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  userId = user.id;

  const customer = await prisma.customer.create({ data: { userId: user.id } });
  customerId = customer.id;

  const serviceAddress = await prisma.serviceAddress.create({
    data: { customerId: customer.id, line1: "100 Test St", city: "Denver", zip: "80201" },
  });
  serviceAddressId = serviceAddress.id;

  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId: customer.id,
      serviceAddressId: serviceAddress.id,
      status: "ACTIVE",
      depositCents: 15000,
      damageWaiverCents: 0,
      taxRatePermille: 73, // 7.3%
    },
  });
  agreementId = agreement.id;

  const line = await prisma.rentalLine.create({
    data: { agreementId: agreement.id, label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4000 },
  });
  lineId = line.id;

  // The fake Stripe client only needs to answer the two calls the
  // handlers actually make: retrieving the full invoice behind a
  // checkout.session.completed/invoice.paid/invoice.payment_failed event,
  // and resolving a payment intent's method for card/ACH bookkeeping.
  // Shaped to match the current Stripe API: subscription/payment-intent
  // references live under parent/payments now, not flat top-level fields —
  // see the extract* helpers in src/domains/billing/webhooks.ts. Keyed by
  // invoice id so each test's numbers stay self-consistent, the way two
  // different real Stripe invoices would.
  fakeInvoicesById = {
    in_fake_1: {
      id: "in_fake_1",
      status: "paid",
      subtotal: 4000,
      total_taxes: [{ amount: 292 }], // 7.3% of 4000, rounded
      amount_due: 19292,
      amount_paid: 19292,
      period_start: 1735689600,
      period_end: 1738368000,
      due_date: null,
      parent: { subscription_details: { subscription: "sub_fake_1" } },
      payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_fake_1" } }] },
      lines: {
        data: [
          { description: "Washer", amount: 4000 },
          { description: "Security deposit", amount: 15000 },
        ],
      },
    },
    in_fake_failed_1: {
      id: "in_fake_failed_1",
      status: "open",
      subtotal: 4000,
      total_taxes: [{ amount: 292 }],
      amount_due: 4292,
      amount_paid: 0,
      period_start: 1738368000,
      period_end: 1741046400,
      due_date: null,
      parent: { subscription_details: { subscription: "sub_fake_1" } },
      payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_fake_failed" } }] },
      lines: { data: [] },
    },
    in_fake_ach_pending: {
      id: "in_fake_ach_pending",
      status: "open", // Stripe hasn't confirmed the bank debit cleared yet
      subtotal: 4000,
      total_taxes: [{ amount: 292 }],
      amount_due: 4292,
      amount_paid: 0,
      period_start: 1738368000,
      period_end: 1741046400,
      due_date: null,
      parent: { subscription_details: { subscription: "sub_fake_1" } },
      payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_fake_ach" } }] },
      lines: { data: [{ description: "Washer", amount: 4000 }] },
    },
  };

  __setStripeClientForTests({
    invoices: {
      retrieve: async (id: string) => fakeInvoicesById[id] as unknown as Stripe.Invoice,
    },
    paymentIntents: {
      retrieve: async () =>
        ({ payment_method: { type: "card" } }) as unknown as Stripe.PaymentIntent,
    },
  } as unknown as Stripe);
});

afterAll(async () => {
  __setStripeClientForTests(null);
  await prisma.payment.deleteMany({ where: { invoice: { agreementId } } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { agreementId } } });
  await prisma.invoice.deleteMany({ where: { agreementId } });
  await prisma.deposit.deleteMany({ where: { agreementId } });
  await prisma.webhookEvent.deleteMany({
    where: {
      id: {
        in: [
          "evt_checkout_1",
          "evt_checkout_1_retry",
          "evt_failed_1",
          "evt_failed_1_recovered",
          "evt_ach_checkout",
          "evt_ach_paid",
        ],
      },
    },
  });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.rentalLine.delete({ where: { id: lineId } });
  await prisma.rentalAgreement.delete({ where: { id: agreementId } });
  await prisma.serviceAddress.delete({ where: { id: serviceAddressId } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.applianceType.delete({ where: { id: applianceTypeId } });
});

describe("processStripeWebhookEvent — checkout.session.completed", () => {
  it("creates the first Invoice, its line items, a succeeded Payment, and a Deposit; advances the agreement's billing state", async () => {
    const event = fakeEvent("evt_checkout_1", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_1",
      metadata: { agreementId },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_1" },
      include: { lineItems: true, payments: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice!.status).toBe("PAID");
    expect(invoice!.customerId).toBe(customerId);
    expect(invoice!.amountPaidCents).toBe(19292);
    expect(invoice!.taxCents).toBe(292);

    const rentalLine = invoice!.lineItems.find((li) => li.kind === "RENTAL");
    expect(rentalLine?.amountCents).toBe(4000);
    expect(rentalLine?.rentalLineId).toBe(lineId); // matched by label, per webhooks.ts

    const depositLine = invoice!.lineItems.find((li) => li.kind === "DEPOSIT");
    expect(depositLine?.amountCents).toBe(15000);

    const taxLine = invoice!.lineItems.find((li) => li.kind === "TAX");
    expect(taxLine?.amountCents).toBe(292);

    expect(invoice!.payments).toHaveLength(1);
    expect(invoice!.payments[0].status).toBe("succeeded");
    expect(invoice!.payments[0].method).toBe("card");

    const deposit = await prisma.deposit.findFirst({ where: { agreementId } });
    expect(deposit?.amountCents).toBe(15000);

    const updatedAgreement = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId },
    });
    expect(updatedAgreement.stripeSubscriptionId).toBe("sub_fake_1");
    expect(updatedAgreement.nextBillingDate?.getTime()).toBe(1738368000 * 1000);
  });

  it("is idempotent — replaying the same event id does not create a second invoice or a second deposit", async () => {
    const event = fakeEvent("evt_checkout_1", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_1",
      metadata: { agreementId },
    });

    await processStripeWebhookEvent(event);

    const invoices = await prisma.invoice.findMany({ where: { agreementId } });
    expect(invoices).toHaveLength(1);

    const deposits = await prisma.deposit.findMany({ where: { agreementId } });
    expect(deposits).toHaveLength(1);
  });

  it("ignores an event with no agreementId in its metadata (not one of ours)", async () => {
    const event = fakeEvent("evt_checkout_1_retry", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_unrelated",
      metadata: {},
    });

    await expect(processStripeWebhookEvent(event)).resolves.not.toThrow();

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_unrelated" },
    });
    expect(invoice).toBeNull();
  });
});

describe("processStripeWebhookEvent — invoice.payment_failed", () => {
  it("creates a DELINQUENT invoice and a failed Payment, without touching Deposit", async () => {
    const event = fakeEvent("evt_failed_1", "invoice.payment_failed", {
      id: "in_fake_failed_1",
      parent: { subscription_details: { subscription: "sub_fake_1" } },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_failed_1" },
      include: { payments: true },
    });
    expect(invoice?.status).toBe("DELINQUENT");
    expect(invoice?.payments[0]?.status).toBe("failed");

    const deposits = await prisma.deposit.findMany({ where: { agreementId } });
    expect(deposits).toHaveLength(1); // still just the one from the earlier test — untouched
  });

  // Real-money bug fixed 2026-09-27 (found by a code review, see
  // docs/DECISIONS.md): a customer who paid successfully on a retry after
  // an earlier failure used to still show as unpaid forever, because
  // invoice.paid saw an Invoice already existed for that stripeInvoiceId
  // (the DELINQUENT one from the failure above) and skipped outright.
  it("invoice.paid for the SAME Stripe invoice, after an earlier failure, updates the DELINQUENT invoice to PAID rather than skipping it", async () => {
    // The customer retried and it went through — Stripe now reports this
    // exact invoice id as paid, with real line items this time.
    fakeInvoicesById.in_fake_failed_1 = {
      ...fakeInvoicesById.in_fake_failed_1,
      status: "paid",
      amount_paid: 4292,
      payments: {
        data: [{ payment: { type: "payment_intent", payment_intent: "pi_fake_failed_retry" } }],
      },
      lines: { data: [{ description: "Washer", amount: 4000 }] },
    };

    const event = fakeEvent("evt_failed_1_recovered", "invoice.paid", {
      id: "in_fake_failed_1",
      parent: { subscription_details: { subscription: "sub_fake_1" } },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_failed_1" },
      include: { payments: true, lineItems: true },
    });
    // Same Invoice row (never a duplicate) — just corrected in place.
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.amountPaidCents).toBe(4292);
    expect(invoice?.lineItems.length).toBeGreaterThan(0);
    // Both the original failed Payment and the new succeeded one are kept
    // — an honest history of what actually happened, not a rewrite of it.
    expect(invoice?.payments).toHaveLength(2);
    expect(invoice?.payments.some((p) => p.status === "failed")).toBe(true);
    expect(invoice?.payments.some((p) => p.status === "succeeded")).toBe(true);

    const invoices = await prisma.invoice.findMany({
      where: { stripeInvoiceId: "in_fake_failed_1" },
    });
    expect(invoices).toHaveLength(1); // proves it was updated, not duplicated
  });
});

describe("processStripeWebhookEvent — checkout.session.completed with a pending (not-yet-settled) invoice", () => {
  // Real-money bug fixed 2026-09-27: this event fires as soon as the
  // customer finishes Checkout, which for ACH is before the bank debit
  // actually clears — the old code recorded it PAID immediately regardless.
  it("does not record anything when Stripe itself still shows the invoice as open (e.g. ACH still clearing)", async () => {
    const event = fakeEvent("evt_ach_checkout", "checkout.session.completed", {
      mode: "subscription",
      invoice: "in_fake_ach_pending",
      metadata: { agreementId },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_ach_pending" },
    });
    expect(invoice).toBeNull(); // nothing recorded yet — correctly so
  });

  it("once the ACH debit clears and invoice.paid fires for that same invoice, it's recorded as PAID for the first time", async () => {
    fakeInvoicesById.in_fake_ach_pending = {
      ...fakeInvoicesById.in_fake_ach_pending,
      status: "paid",
      amount_paid: 4292,
    };

    const event = fakeEvent("evt_ach_paid", "invoice.paid", {
      id: "in_fake_ach_pending",
      parent: { subscription_details: { subscription: "sub_fake_1" } },
    });

    await processStripeWebhookEvent(event);

    const invoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: "in_fake_ach_pending" },
    });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.amountPaidCents).toBe(4292);
  });
});
