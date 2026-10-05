import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ intent: vi.fn(), invoice: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    paymentIntents: { retrieve: m.intent },
    invoices: { retrieve: m.invoice },
  }),
}));
import { prisma } from "@/lib/prisma";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";

const url = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("atomic webhook processing in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `wh-user-${tag}`;
  const customerId = `wh-customer-${tag}`;
  const addressId = `wh-address-${tag}`;
  const agreements: string[] = [];
  const events: string[] = [];
  const trigger = `wh_fail_${tag}`;
  const failureEventId = `evt_failure_${tag}`;

  function event(
    type: string,
    object: unknown,
    id = `evt_${randomUUID()}`,
  ): Stripe.Event {
    events.push(id);
    return { id, type, data: { object } } as Stripe.Event;
  }

  async function agreement() {
    const id = `wh-agreement-${randomUUID()}`;
    agreements.push(id);
    await prisma.rentalAgreement.create({
      data: {
        id,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        depositCents: 15000,
        damageWaiverCents: 2500,
      },
    });
    return id;
  }

  function session(
    agreementId: string,
    paymentIntentId: string,
    paid = true,
  ) {
    return {
      mode: "payment",
      payment_intent: paymentIntentId,
      payment_status: paid ? "paid" : "unpaid",
      metadata: { agreementId },
    };
  }

  async function chargeCount(agreementId: string) {
    return prisma.payment.count({
      where: { invoice: { agreementId }, status: "succeeded" },
    });
  }

  async function receiptCount(agreementId: string) {
    return prisma.receipt.count({
      where: { payments: { some: { invoice: { agreementId } } } },
    });
  }

  async function dropFailureTrigger() {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${trigger}" ON "WebhookEvent"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${trigger}"()`,
    );
  }

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${tag}@example.test`,
        name: "Webhook fixture",
        role: "CUSTOMER",
      },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: tag },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "100 Test St",
        city: "Denver",
        zip: "80201",
      },
    });
    m.intent.mockImplementation(async (id: string) => ({
      id,
      payment_method: { id: `pm_${id}`, type: "us_bank_account" },
      latest_charge: null,
    }));
  });

  afterAll(async () => {
    await dropFailureTrigger();
    const invoices = await prisma.invoice.findMany({
      where: { customerId },
      select: { id: true },
    });
    const invoiceIds = invoices.map((row) => row.id);
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.deposit.deleteMany({ where: { agreementId: { in: agreements } } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: agreements } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreements } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
  });

  it("commits simultaneous deliveries of one event once", async () => {
    const id = await agreement();
    const e = event(
      "checkout.session.completed",
      session(id, `pi_duplicate_${tag}`),
    );
    await Promise.all([processStripeWebhookEvent(e), processStripeWebhookEvent(e)]);
    expect(await chargeCount(id)).toBe(1);
    expect(await receiptCount(id)).toBe(1);
    expect(await prisma.invoice.count({ where: { agreementId: id } })).toBe(1);
    expect(await prisma.deposit.count({ where: { agreementId: id } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(1);
  });

  it("dedupes distinct completed/async-success events for the same signing payment", async () => {
    const id = await agreement();
    const data = session(id, `pi_distinct_${tag}`);
    const a = event("checkout.session.completed", data);
    const b = event("checkout.session.async_payment_succeeded", data);
    await Promise.all([processStripeWebhookEvent(a), processStripeWebhookEvent(b)]);
    expect(await chargeCount(id)).toBe(1);
    expect(await receiptCount(id)).toBe(1);
    expect(await prisma.invoice.count({ where: { agreementId: id } })).toBe(1);
    expect(
      await prisma.webhookEvent.count({ where: { id: { in: [a.id, b.id] } } }),
    ).toBe(2);
  });

  it("records no money for pending ACH, then records settlement exactly once", async () => {
    const id = await agreement();
    const data = session(id, `pi_pending_${tag}`, false);
    await processStripeWebhookEvent(event("checkout.session.completed", data));
    expect(await chargeCount(id)).toBe(0);
    expect(await receiptCount(id)).toBe(0);
    expect(await prisma.deposit.count({ where: { agreementId: id } })).toBe(0);
    const e = event("checkout.session.async_payment_succeeded", data);
    await processStripeWebhookEvent(e);
    await processStripeWebhookEvent(e);
    expect(await chargeCount(id)).toBe(1);
    expect(await receiptCount(id)).toBe(1);
    expect(
      await prisma.payment.findFirstOrThrow({
        where: { invoice: { agreementId: id } },
      }),
    ).toMatchObject({ method: "ach", amountCents: 17500 });
  });

  it("keeps failed ACH unpaid and dedupes its audit", async () => {
    const id = await agreement();
    const data = session(id, `pi_failed_${tag}`, false);
    await processStripeWebhookEvent(event("checkout.session.completed", data));
    const e = event("checkout.session.async_payment_failed", data);
    await Promise.all([processStripeWebhookEvent(e), processStripeWebhookEvent(e)]);
    expect(await chargeCount(id)).toBe(0);
    expect(await receiptCount(id)).toBe(0);
    expect(await prisma.invoice.count({ where: { agreementId: id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: id,
          action: "billing.signing_payment_failed",
        },
      }),
    ).toBe(1);
  });

  it("rolls back receipt, allocation and deposit when the final webhook receipt fails; retry succeeds once", async () => {
    const id = await agreement();
    const before = (
      await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })
    ).stripeDefaultPaymentMethodId;
    const e = event(
      "checkout.session.completed",
      session(id, `pi_rollback_${tag}`),
      failureEventId,
    );
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${failureEventId}' THEN RAISE EXCEPTION 'owned webhook receipt failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "WebhookEvent" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`,
    );
    try {
      await expect(processStripeWebhookEvent(e)).rejects.toThrow();
      expect(await chargeCount(id)).toBe(0);
      expect(await receiptCount(id)).toBe(0);
      expect(await prisma.invoice.count({ where: { agreementId: id } })).toBe(0);
      expect(await prisma.deposit.count({ where: { agreementId: id } })).toBe(0);
      expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(0);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }))
          .stripeDefaultPaymentMethodId,
      ).toBe(before);
    } finally {
      await dropFailureTrigger();
    }
    await processStripeWebhookEvent(e);
    await processStripeWebhookEvent(e);
    expect(await chargeCount(id)).toBe(1);
    expect(await receiptCount(id)).toBe(1);
    expect(await prisma.deposit.count({ where: { agreementId: id } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { id: e.id } })).toBe(1);
  });

  it("serializes cumulative refunds with different event IDs, including out-of-order delivery", async () => {
    const id = await agreement();
    const pi = `pi_refund_${tag}`;
    await processStripeWebhookEvent(
      event("checkout.session.completed", session(id, pi)),
    );
    const large = event("charge.refunded", {
      payment_intent: pi,
      amount_refunded: 250,
      refunds: { data: [] },
    });
    const small = event("charge.refunded", {
      payment_intent: pi,
      amount_refunded: 100,
      refunds: { data: [] },
    });
    await Promise.all([
      processStripeWebhookEvent(large),
      processStripeWebhookEvent(small),
    ]);
    await processStripeWebhookEvent(large);
    const total = await prisma.refund.aggregate({
      where: { invoice: { agreementId: id } },
      _sum: { amountCents: true },
    });
    expect(total._sum.amountCents).toBe(250);
  });

  it("dedupes a legacy checkout and invoice-paid event describing the same invoice", async () => {
    const id = await agreement();
    const subscription = `sub_${tag}`;
    const invoiceId = `in_${tag}`;
    await prisma.rentalAgreement.update({
      where: { id },
      data: { stripeSubscriptionId: subscription },
    });
    const invoice = {
      id: invoiceId,
      status: "paid",
      amount_due: 4000,
      amount_paid: 4000,
      parent: { subscription_details: { subscription } },
      total_taxes: [],
      payments: {
        data: [
          { payment: { payment_intent: `pi_legacy_${tag}` } },
        ],
      },
      lines: { data: [{ description: "Washer", amount: 4000 }] },
    };
    m.invoice.mockResolvedValue(invoice);
    const a = event("checkout.session.completed", {
      mode: "subscription",
      invoice: invoiceId,
      metadata: { agreementId: id },
    });
    const b = event("invoice.paid", invoice);
    await Promise.all([processStripeWebhookEvent(a), processStripeWebhookEvent(b)]);
    expect(await chargeCount(id)).toBe(1);
    expect(await receiptCount(id)).toBe(1);
    expect(
      await prisma.invoice.count({ where: { stripeInvoiceId: invoiceId } }),
    ).toBe(1);
    expect(
      await prisma.webhookEvent.count({ where: { id: { in: [a.id, b.id] } } }),
    ).toBe(2);
  });
});
