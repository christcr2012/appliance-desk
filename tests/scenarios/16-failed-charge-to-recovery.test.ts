// PLAN scenario 16 (BATCH-F WU-F4): an automatic charge fails, the owner gets a To do, the customer pays from the portal's
// "Pay now" link, the payment applies once, the To do clears, and replays never charge or record twice.
// Stripe is faked at the client boundary; no real provider acceptance is claimed.
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const stripe = vi.hoisted(() => ({ invoice: {} as Record<string, unknown>, retrieves: 0 }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    invoices: { retrieve: async () => { stripe.retrieves++; return stripe.invoice; } },
    subscriptions: { retrieve: async () => ({ id: "unused", metadata: {} }) },
    paymentIntents: { retrieve: async (id: string) => ({ id, payment_method: { id: `pm_${id}`, type: "card" }, latest_charge: null }) },
  }),
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
let owner = "";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { SUCCESSFUL_PAYMENT_STATUSES } from "@/domains/billing/payment-status";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { ensureSubscriptionIdentityForWebhook } from "@/domains/billing/subscription-identity";
import { getPayNowUrl, PayNowError } from "@/domains/portal/pay-now";
import { getExceptions } from "@/domains/exceptions";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);

describe.skipIf(!enabled)("scenario 16: failed charge to recovery", () => {
  const tag = randomUUID().replaceAll("-", "");
  const users = [`s16-user-a-${tag}`, `s16-user-b-${tag}`];
  const customers = [`s16-cust-a-${tag}`, `s16-cust-b-${tag}`];
  const addressId = `s16-address-${tag}`;
  const agreementId = `s16-agreement-${tag}`;
  const subscription = `sub_s16_${tag}`;
  const stripeInvoiceId = `in_s16_${tag}`;
  const events: string[] = [];

  async function deliver(type: string, object: unknown) {
    const id = `evt_${randomUUID()}`;
    events.push(id);
    const event = { id, type, data: { object } } as Stripe.Event;
    await ensureSubscriptionIdentityForWebhook(event);
    return { id, event, result: await processStripeWebhookEvent(event) };
  }

  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    for (let i = 0; i < 2; i++) {
      await prisma.user.create({ data: { id: users[i], email: `${tag}-${i}@example.test`, name: `S16 Customer ${i}`, role: "CUSTOMER", emailVerified: true } });
      await prisma.customer.create({ data: { id: customers[i], userId: users[i], referralCode: `S${i}${tag.slice(0, 17)}` } });
    }
    await prisma.serviceAddress.create({ data: { id: addressId, customerId: customers[0], line1: "16 Test St", city: "Greeley", zip: "80631" } });
    await prisma.rentalAgreement.create({
      data: { id: agreementId, customerId: customers[0], serviceAddressId: addressId, status: "ACTIVE", stripeSubscriptionId: subscription },
    });
  });

  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const invoices = (await prisma.invoice.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((i) => i.id);
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: customers } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: customers } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [agreementId, ...invoices] } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: { in: customers } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
  });

  it("failure -> To do -> customer pays now -> one payment -> To do clears; replays change nothing", async () => {
    const mirrored = await prisma.invoice.create({
      data: { customerId: customers[0], agreementId, stripeInvoiceId, status: "OPEN", amountDueCents: 5200, dueDate: null },
    });
    const todoFor = async () => (await getExceptions()).filter((item) => item.category === "PAST_DUE_INVOICE" && JSON.stringify(item).includes(mirrored.id));
    const successfulPayments = () =>
      prisma.payment.count({ where: { invoiceId: mirrored.id, status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] } } });

    // 1. The automatic charge fails (twice delivered): one failed attempt, the bill is DELINQUENT.
    const failedObject = { id: stripeInvoiceId, amount_due: 5200, parent: { subscription_details: { subscription } } };
    const failed = await deliver("invoice.payment_failed", failedObject);
    await processStripeWebhookEvent(failed.event);
    const afterFailure = await prisma.invoice.findUniqueOrThrow({ where: { id: mirrored.id }, include: { payments: true } });
    expect(afterFailure.status).toBe("DELINQUENT");
    expect(afterFailure.payments.filter((p) => p.status === "failed")).toHaveLength(1);

    // 2. The owner has a To do for it, with the amount, that links to the invoice page.
    const todos = await todoFor();
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toMatch(/payment failed/i);
    expect(todos[0].amountCents).toBe(5200);
    expect(todos[0].href).toBe(`/desk/billing/customer/${customers[0]}/invoice/${mirrored.id}`);

    // 3. The customer pays now from the portal; another customer cannot use that bill.
    stripe.invoice = { id: stripeInvoiceId, status: "open", amount_remaining: 5200, hosted_invoice_url: `https://pay.example.test/${tag}` };
    expect(await getPayNowUrl(users[0], mirrored.id)).toBe(`https://pay.example.test/${tag}`);
    await expect(getPayNowUrl(users[1], mirrored.id)).rejects.toBeInstanceOf(PayNowError);

    // 4. Stripe reports the payment: it applies once, with one receipt, and the bill is PAID.
    const paidObject = {
      id: stripeInvoiceId, status: "paid", amount_due: 5200, amount_paid: 5200,
      parent: { subscription_details: { subscription } }, total_taxes: [],
      payments: { data: [{ payment: { payment_intent: `pi_s16_${tag}` } }] },
      lines: { data: [{ description: "Washer", amount: 5200 }] },
    };
    stripe.invoice = paidObject;
    const paid = await deliver("invoice.paid", paidObject);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: mirrored.id } })).status).toBe("PAID");
    expect(await successfulPayments()).toBe(1);
    expect(await prisma.receipt.count({ where: { payments: { some: { invoiceId: mirrored.id } } } })).toBe(1);

    // 5. The To do clears, and the paid bill can no longer be paid online.
    expect(await todoFor()).toHaveLength(0);
    await expect(getPayNowUrl(users[0], mirrored.id)).rejects.toBeInstanceOf(PayNowError);

    // 6. Replays: the same paid message, a fresh copy of it, and a late copy of the failure change nothing.
    await processStripeWebhookEvent(paid.event);
    await deliver("invoice.paid", paidObject);
    await deliver("invoice.payment_failed", failedObject);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: mirrored.id } })).status).toBe("PAID");
    expect(await successfulPayments()).toBe(1);
    expect(await prisma.receipt.count({ where: { payments: { some: { invoiceId: mirrored.id } } } })).toBe(1);
    expect(await todoFor()).toHaveLength(0);
  });
});
