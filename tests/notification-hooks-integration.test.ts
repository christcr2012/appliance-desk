import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// AR-13 S3: the five event hooks. Stripe is faked exactly like the webhook ordering suite;
// everything else runs against the real throwaway Postgres.
const m = vi.hoisted(() => ({ invoice: vi.fn(), subscription: vi.fn(), intent: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    invoices: { retrieve: m.invoice },
    subscriptions: { retrieve: m.subscription },
    paymentIntents: { retrieve: m.intent },
  }),
}));

import { prisma } from "@/lib/prisma";
import { createLead, createLeadManually } from "@/domains/leads";
import { leadFormSchemaForCatalog } from "@/domains/leads/schema";
import { getEstimateForApproval } from "@/domains/estimates";
import { submitWriteOff } from "@/domains/approvals";
import { notifySafely } from "@/domains/notifications";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { ensureSubscriptionIdentityForWebhook } from "@/domains/billing/subscription-identity";

const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const waitForRows = (where: object, atLeast = 1) =>
  vi.waitFor(
    async () => {
      expect(await prisma.notification.count({ where })).toBeGreaterThanOrEqual(atLeast);
    },
    { timeout: 8000, interval: 100 },
  );

describe.skipIf(!enabled)("notification hooks (AR-13)", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let adminA: string; // actor: creates leads by hand, asks for approvals
  let adminB: string; // recipient
  let customerId: string;
  let customerUserId: string;
  let addressId: string;
  let savedThresholds: unknown;
  const userIds: string[] = [];
  const leadIds: string[] = [];
  const estimateIds: string[] = [];
  const invoiceIds: string[] = [];
  const agreementIds: string[] = [];
  const eventIds: string[] = [];

  async function deliver(event: Stripe.Event) {
    await ensureSubscriptionIdentityForWebhook(event);
    return processStripeWebhookEvent(event);
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
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null } })).id;
    const mk = async (label: string) => {
      const user = await prisma.user.create({
        data: { email: `ar13-hooks-${label}-${tag}@example.test`, name: `Hooks ${label}`, role: "ADMIN" },
      });
      userIds.push(user.id);
      return user.id;
    };
    adminA = await mk("a");
    adminB = await mk("b");
    const customerUser = await prisma.user.create({
      data: { email: `ar13-hooks-customer-${tag}@example.test`, name: "Viewing Customer", role: "CUSTOMER" },
    });
    customerUserId = customerUser.id;
    const customer = await prisma.customer.create({
      data: { userId: customerUserId, referralCode: `H${tag}xxxxxxxxxx`.slice(0, 12) },
    });
    customerId = customer.id;
    const address = await prisma.serviceAddress.create({
      data: { customerId, line1: "100 Test St", city: "Greeley", zip: "80631" },
    });
    addressId = address.id;
    // Approval limits start unset (nothing requires approval); set a write-off limit so the ask
    // routes to the owner, and restore the original afterwards (shared-settings discipline).
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { approvalThresholds: true },
    });
    savedThresholds = settings.approvalThresholds;
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { approvalThresholds: { WRITE_OFF: 5000 } },
    });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { userId: ownerId, kind: "APPROVAL_REQUESTED", title: { contains: tag } }] } });
    await prisma.notification.deleteMany({ where: { entityId: { in: [...leadIds, ...estimateIds, ...invoiceIds] } } });
    await prisma.approvalRequest.deleteMany({ where: { requestedByUserId: adminA } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { entityId: { in: [...agreementIds, ...invoiceIds, ...leadIds, ...estimateIds] } }] },
    });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    for (const leadId of leadIds) {
      await prisma.consentRecord.deleteMany({ where: { details: { path: ["leadId"], equals: leadId } } });
      await prisma.leadNote.deleteMany({ where: { leadId } });
      await prisma.lead.deleteMany({ where: { id: leadId } });
    }
    await prisma.webhookEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { approvalThresholds: savedThresholds as object },
    });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds, customerUserId] } } });
  });

  it("LEAD_NEW (manual): the creator is skipped, another admin is notified", async () => {
    const lead = await createLeadManually(adminA, { contactName: `Manual ${tag}`, phone: "9705550111", city: "Greeley" });
    leadIds.push(lead.id);
    await waitForRows({ userId: adminB, kind: "LEAD_NEW", entityId: lead.id });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: adminB, entityId: lead.id } });
    expect(row.title).toBe(`New lead: Manual ${tag}`);
    expect(row.body).toContain("Greeley");
    expect(row.href).toBe(`/desk/leads/${lead.id}`);
    expect(await prisma.notification.count({ where: { userId: adminA, entityId: lead.id } })).toBe(0);
  });

  it("LEAD_NEW (public form): a website lead notifies the admins", async () => {
    const input = leadFormSchemaForCatalog(false).parse({
      accountType: "individual",
      isPropertyManager: false,
      contactName: `Web ${tag}`,
      phone: "9705550112",
      applianceTypeIds: [],
      quantity: 1,
      desiredTerm: "month-to-month",
      consent: true,
    });
    const lead = await createLead(input);
    leadIds.push(lead.id);
    await waitForRows({ userId: adminB, kind: "LEAD_NEW", entityId: lead.id });
    expect(await prisma.notification.count({ where: { userId: adminB, entityId: lead.id } })).toBe(1);
  });

  it("QUOTE_VIEWED: the first view notifies once; a second view adds nothing", async () => {
    const estimate = await prisma.estimate.create({
      data: {
        customerId,
        createdByUserId: adminB,
        title: `Quote fixture ${tag}`,
        status: "SENT",
        sentAt: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    estimateIds.push(estimate.id);
    const read = await getEstimateForApproval(estimate.id);
    expect(read?.status).toBe("VIEWED");
    await waitForRows({ userId: adminA, kind: "QUOTE_VIEWED", entityId: estimate.id });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: adminA, entityId: estimate.id } });
    expect(row.title).toBe(`Viewing Customer opened quote #${estimate.estimateNumber}`);
    expect(row.body).toMatch(/^Sent /);
    await getEstimateForApproval(estimate.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { kind: "QUOTE_VIEWED", entityId: estimate.id, userId: adminA } })).toBe(1);
  });

  it("APPROVAL_REQUESTED: a big write-off ask notifies the owner, once", async () => {
    const invoice = await prisma.invoice.create({
      data: { customerId, status: "OPEN", amountDueCents: 100_000_000, amountPaidCents: 0 },
    });
    invoiceIds.push(invoice.id);
    const result = await submitWriteOff(adminA, invoice.id, `Fixture ${tag}`);
    expect(result.status).toBe("SENT_FOR_APPROVAL");
    if (result.status !== "SENT_FOR_APPROVAL") return;
    await waitForRows({ userId: ownerId, kind: "APPROVAL_REQUESTED", entityId: result.requestId });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: ownerId, entityId: result.requestId } });
    expect(row.title).toContain("Approval needed:");
    expect(row.body).toContain("Hooks a");
    // A repeat ask for the same invoice is ALREADY_WAITING and makes no new notification.
    const again = await submitWriteOff(adminA, invoice.id, `Fixture ${tag}`);
    expect(again.status).toBe("ALREADY_WAITING");
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { kind: "APPROVAL_REQUESTED", entityId: result.requestId } })).toBe(1);
  });

  it("PAYMENT_FAILED: a failed bill notifies once per Stripe event, replays add nothing", async () => {
    const subscription = `sub_ar13_${tag}`;
    const agreement = await prisma.rentalAgreement.create({
      data: { customerId, serviceAddressId: addressId, status: "ACTIVE", stripeSubscriptionId: subscription },
    });
    agreementIds.push(agreement.id);
    const stripeInvoiceId = `in_ar13_${tag}`;
    const invoice = await prisma.invoice.create({
      data: { customerId, agreementId: agreement.id, stripeInvoiceId, status: "OPEN", amountDueCents: 5200 },
    });
    invoiceIds.push(invoice.id);
    const eventId = `evt_ar13_${tag}`;
    eventIds.push(eventId);
    const failed = {
      id: eventId,
      type: "invoice.payment_failed",
      data: {
        object: {
          id: stripeInvoiceId,
          amount_due: 5200,
          parent: { subscription_details: { subscription } },
        },
      },
    } as unknown as Stripe.Event;
    await deliver(failed);
    await waitForRows({ userId: adminB, kind: "PAYMENT_FAILED", dedupeKey: `PAYMENT_FAILED:${eventId}` });
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: adminB, dedupeKey: `PAYMENT_FAILED:${eventId}` },
    });
    expect(row.title).toBe("Payment failed: Viewing Customer");
    expect(row.body).toContain(`bill #${invoice.invoiceNumber}`);
    expect(row.href).toBe(`/desk/billing/customer/${customerId}/invoice/${invoice.id}`);
    // Every active owner/admin in the database got one; a replay of the same event adds none.
    const afterFirst = await prisma.notification.count({ where: { dedupeKey: `PAYMENT_FAILED:${eventId}` } });
    expect(afterFirst).toBeGreaterThan(0);
    await deliver(failed);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { dedupeKey: `PAYMENT_FAILED:${eventId}` } })).toBe(afterFirst);
    expect(await prisma.notification.count({ where: { userId: adminB, dedupeKey: `PAYMENT_FAILED:${eventId}` } })).toBe(1);
  });

  it("a failing notification never fails the action that caused it", async () => {
    // notify() throws on a non-desk link; notifySafely (the seam every hook uses) must swallow it.
    expect(() =>
      notifySafely({
        kind: "LEAD_NEW",
        dedupeKey: `LEAD_NEW:ar13-poison-${tag}`,
        title: "Poison",
        body: "Poison",
        href: "https://example.test/not-a-desk-link",
        entityType: "Lead",
        entityId: `ar13-poison-${tag}`,
      }),
    ).not.toThrow();
    const lead = await createLeadManually(adminA, { contactName: `Isolation ${tag}`, phone: "9705550113" });
    leadIds.push(lead.id);
    expect(lead.contactName).toBe(`Isolation ${tag}`);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { dedupeKey: `LEAD_NEW:ar13-poison-${tag}` } })).toBe(0);
  });
});
