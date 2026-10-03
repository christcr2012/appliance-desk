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
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { ensureSubscriptionIdentityForWebhook } from "@/domains/billing/subscription-identity";
import { EARLY_RETURN_CREDIT_SOURCE } from "@/domains/billing/pickup-billing";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

async function deliver(event: Stripe.Event) {
  await ensureSubscriptionIdentityForWebhook(event);
  return processStripeWebhookEvent(event);
}

// An early-return credit was sent to Stripe as account balance. When the next
// monthly bill arrives, the mirrored invoice must show that credit as its own
// labeled line — and a replayed webhook must not show it twice or on two bills.
describe.skipIf(!enabled)("early-return credit shown on the next bill (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `er-user-${tag}`;
  const customerId = `er-customer-${tag}`;
  const addressId = `er-address-${tag}`;
  const agreementId = `er-agreement-${tag}`;
  const subscription = `sub_er_${tag}`;
  const events: string[] = [];

  function event(type: string, object: unknown): Stripe.Event {
    const id = `evt_${randomUUID()}`;
    events.push(id);
    return { id, type, data: { object } } as Stripe.Event;
  }

  function paidInvoice(invoiceId: string, balance: { starting: number; ending: number }) {
    return {
      id: invoiceId,
      status: "paid",
      amount_due: 6000 - (balance.ending - balance.starting),
      amount_paid: 6000 - (balance.ending - balance.starting),
      starting_balance: balance.starting,
      ending_balance: balance.ending,
      parent: { subscription_details: { subscription } },
      total_taxes: [],
      payments: { data: [{ payment: { payment_intent: `pi_${invoiceId}` } }] },
      lines: { data: [{ description: "Washer/Dryer set", amount: 6000 }] },
    };
  }

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
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Early return fixture", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `E${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "100 Test St", city: "Denver", zip: "80201" } });
    await prisma.rentalAgreement.create({
      data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE", stripeSubscriptionId: subscription },
    });
    await prisma.customerCredit.create({
      data: {
        customerId,
        amountCents: 1000,
        remainingCents: 0,
        reason: "Credit – Dryer #D-7 returned early – 10 days",
        sourceType: EARLY_RETURN_CREDIT_SOURCE,
        sourceId: `job-${tag}:d7`,
        side: "CUSTOMER",
        appliedViaStripeAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    const invoices = await prisma.invoice.findMany({ where: { customerId }, select: { id: true } });
    const ids = invoices.map((row) => row.id);
    await prisma.payment.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { entityId: agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
  });

  it("shows the credit as its own labeled line once, marks the credit as shown, and ignores a replay and the following bill", async () => {
    // Stripe held -$10.00 of balance and used all of it on this $60 bill.
    const first = paidInvoice(`in_er1_${tag}`, { starting: -1000, ending: 0 });
    m.invoice.mockResolvedValue(first);
    const paid = event("invoice.paid", first);
    await deliver(paid);
    await deliver(paid); // Stripe re-sends the same message
    await deliver(event("invoice.paid", first)); // and once more under a new id

    const mirrored = await prisma.invoice.findUniqueOrThrow({
      where: { stripeInvoiceId: first.id },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
    });
    const creditLines = mirrored.lineItems.filter((line) => line.kind === "CREDIT");
    expect(creditLines).toHaveLength(1);
    expect(creditLines[0]).toMatchObject({ description: "Credit – Dryer #D-7 returned early – 10 days", amountCents: -1000 });
    expect(mirrored.subtotalCents).toBe(5000);
    expect(await prisma.invoice.count({ where: { stripeInvoiceId: first.id } })).toBe(1);

    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceType: EARLY_RETURN_CREDIT_SOURCE } });
    expect(credit.shownOnInvoiceId).toBe(mirrored.id);

    // The following month: no balance used, so no credit line and the old credit stays where it was shown.
    const second = paidInvoice(`in_er2_${tag}`, { starting: 0, ending: 0 });
    m.invoice.mockResolvedValue(second);
    await deliver(event("invoice.paid", second));
    const next = await prisma.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: second.id }, include: { lineItems: true } });
    expect(next.lineItems.filter((line) => line.kind === "CREDIT")).toHaveLength(0);
    expect(next.subtotalCents).toBe(6000);
    expect((await prisma.customerCredit.findUniqueOrThrow({ where: { id: credit.id } })).shownOnInvoiceId).toBe(mirrored.id);
  });
});
