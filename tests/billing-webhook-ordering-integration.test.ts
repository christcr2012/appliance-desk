import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ invoice: vi.fn(), subscription: vi.fn(), intent: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    invoices: { retrieve: m.invoice },
    subscriptions: { retrieve: m.subscription },
    paymentIntents: { retrieve: m.intent },
  }),
}));

import { prisma } from "@/lib/prisma";
import { SUCCESSFUL_PAYMENT_STATUSES } from "@/domains/billing/payment-status";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { ensureSubscriptionIdentityForWebhook } from "@/domains/billing/subscription-identity";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

/** The same steps the real webhook route takes for every event. */
async function deliver(event: Stripe.Event) {
  await ensureSubscriptionIdentityForWebhook(event);
  return processStripeWebhookEvent(event);
}

describe.skipIf(!enabled)("Stripe messages that arrive out of order (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `wo-user-${tag}`;
  const customerId = `wo-customer-${tag}`;
  const addressId = `wo-address-${tag}`;
  const agreements: string[] = [];
  const events: string[] = [];

  function event(type: string, object: unknown): Stripe.Event {
    const id = `evt_${randomUUID()}`;
    events.push(id);
    return { id, type, data: { object } } as Stripe.Event;
  }

  async function agreement(subscription: string | null) {
    const id = `wo-agreement-${randomUUID()}`;
    agreements.push(id);
    await prisma.rentalAgreement.create({
      data: {
        id,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        stripeSubscriptionId: subscription,
      },
    });
    return id;
  }

  function paidInvoice(invoiceId: string, subscription: string) {
    return {
      id: invoiceId,
      status: "paid",
      amount_due: 4000,
      amount_paid: 4000,
      parent: { subscription_details: { subscription } },
      total_taxes: [],
      payments: { data: [{ payment: { payment_intent: `pi_${invoiceId}` } }] },
      lines: { data: [{ description: "Washer", amount: 4000 }] },
    };
  }

  const payments = (agreementId: string) =>
    prisma.payment.count({ where: { invoice: { agreementId }, status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] } } });
  const receipts = (agreementId: string) =>
    prisma.receipt.count({ where: { payments: { some: { invoice: { agreementId } } } } });

  beforeEach(() => {
    m.invoice.mockReset();
    m.subscription.mockReset();
    m.intent.mockReset().mockImplementation(async (id: string) => ({
      id,
      payment_method: { id: `pm_${id}`, type: "card" },
      latest_charge: null,
    }));
  });

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, name: "Ordering fixture", role: "CUSTOMER" },
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `O${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "100 Test St", city: "Denver", zip: "80201" },
    });
  });

  afterAll(async () => {
    const invoices = await prisma.invoice.findMany({ where: { customerId }, select: { id: true } });
    const invoiceIds = invoices.map((row) => row.id);
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: agreements } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreements } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
  });

  it("invoice.paid arriving BEFORE checkout.session.completed records the payment once, and the late checkout message adds nothing", async () => {
    const subscription = `sub_a_${tag}`;
    const id = await agreement(subscription);
    const invoice = paidInvoice(`in_a_${tag}`, subscription);
    m.invoice.mockResolvedValue(invoice);

    await deliver(event("invoice.paid", invoice));
    expect(await payments(id)).toBe(1);

    await deliver(event("checkout.session.completed", { mode: "subscription", invoice: invoice.id, metadata: { agreementId: id } }));
    expect(await payments(id)).toBe(1);
    expect(await receipts(id)).toBe(1);
    expect(await prisma.invoice.count({ where: { stripeInvoiceId: invoice.id } })).toBe(1);
  });

  it("invoice.paid arriving before the subscription is linked to the agreement heals the link from Stripe and records the payment once", async () => {
    const subscription = `sub_b_${tag}`;
    const id = await agreement(null);
    m.subscription.mockResolvedValue({ id: subscription, metadata: { agreementId: id } });
    const invoice = paidInvoice(`in_b_${tag}`, subscription);
    m.invoice.mockResolvedValue(invoice);

    const first = event("invoice.paid", invoice);
    await deliver(first);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id } })).stripeSubscriptionId).toBe(subscription);
    expect(await payments(id)).toBe(1);

    // Stripe re-sends the same event: nothing doubles.
    await deliver(first);
    await deliver(event("invoice.paid", invoice));
    expect(await payments(id)).toBe(1);
    expect(await receipts(id)).toBe(1);
  });

  it("customer.subscription.deleted arriving before the link still links, notes the ending once, and ignores a replay", async () => {
    const subscription = `sub_c_${tag}`;
    const id = await agreement(null);
    const deleted = event("customer.subscription.deleted", { id: subscription, metadata: { agreementId: id } });
    await deliver(deleted);
    await deliver(deleted);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id } })).stripeSubscriptionId).toBe(subscription);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "billing.subscription_ended" } })).toBe(1);
  });

  it("moves a previously mirrored OPEN invoice to DELINQUENT, records one failed attempt, and replays safely", async () => {
    const subscription = `sub_failed_${tag}`;
    const agreementId = await agreement(subscription);
    const stripeInvoiceId = `in_open_failed_${tag}`;
    const original = await prisma.invoice.create({
      data: { customerId, agreementId, stripeInvoiceId, status: "OPEN", amountDueCents: 5200, dueDate: null },
    });
    const failed = event("invoice.payment_failed", {
      id: stripeInvoiceId,
      amount_due: 5200,
      parent: { subscription_details: { subscription } },
    });

    await deliver(failed);
    await deliver(failed);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: original.id }, include: { payments: true } });
    expect(row.status).toBe("DELINQUENT");
    expect(row.dueDate).toBeNull();
    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({ status: "failed", amountCents: 5200 });

    // An out-of-order failure may be recorded, but must never reopen a void invoice.
    await prisma.invoice.update({ where: { id: original.id }, data: { status: "VOID" } });
    await deliver(event("invoice.payment_failed", {
      id: stripeInvoiceId, amount_due: 5200, parent: { subscription_details: { subscription } },
    }));
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: original.id } })).status).toBe("VOID");
  });

  it("a payment failure then the payment itself, in either arrival order, ends with the invoice paid and one payment", async () => {
    const subscription = `sub_d_${tag}`;
    const id = await agreement(subscription);
    const invoice = paidInvoice(`in_d_${tag}`, subscription);
    m.invoice.mockResolvedValue(invoice);
    // The paid message overtakes the earlier failure message.
    await deliver(event("invoice.paid", invoice));
    await deliver(event("invoice.payment_failed", { ...invoice, status: "open", amount_paid: 0 }));
    const row = await prisma.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } });
    expect(row.status).toBe("PAID");
    expect(await payments(id)).toBe(1);
  });

  it("a subscription that belongs to no agreement (no link, no metadata) is acknowledged and changes nothing", async () => {
    const subscription = `sub_e_${tag}`;
    m.subscription.mockResolvedValue({ id: subscription, metadata: {} });
    const invoice = paidInvoice(`in_e_${tag}`, subscription);
    const before = await prisma.payment.count({ where: { invoice: { customerId } } });
    await deliver(event("invoice.paid", invoice));
    expect(await prisma.payment.count({ where: { invoice: { customerId } } })).toBe(before);
    expect(await prisma.invoice.count({ where: { stripeInvoiceId: invoice.id } })).toBe(0);
  });
});
