import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ invoice: vi.fn(), subscription: vi.fn(), intent: vi.fn(), balance: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    invoices: { retrieve: m.invoice },
    subscriptions: { retrieve: m.subscription },
    paymentIntents: { retrieve: m.intent },
    customers: { createBalanceTransaction: m.balance },
  }),
}));

import { prisma } from "@/lib/prisma";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { ensureSubscriptionIdentityForWebhook } from "@/domains/billing/subscription-identity";
import { LATE_DELIVERY_CREDIT_SOURCE } from "@/domains/billing/pickup-billing";
import { removeUndeliveredItem } from "@/domains/billing/pickup-billing-events";
import { businessDateFromKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

async function deliver(event: Stripe.Event) {
  await ensureSubscriptionIdentityForWebhook(event);
  return processStripeWebhookEvent(event);
}

// Late-delivery credits on the next bill, and the never-delivered case, against
// a real Postgres: the credit shows once as its own line (a replayed webhook
// adds nothing), an old credit from before the rule is never relabeled, and an
// item taken off the agreement is credited everything billed for it.
describe.skipIf(!enabled)("late-delivery credits (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `ld-owner-${tag}`;
  const userId = `ld-user-${tag}`;
  const customerId = `ld-customer-${tag}`;
  const addressId = `ld-address-${tag}`;
  const agreementId = `ld-agreement-${tag}`;
  const typeId = `ld-type-${tag}`;
  const applianceId = `ld-dryer-${tag}`;
  const washerId = `ld-washer-${tag}`;
  const jobId = `ld-job-${tag}`;
  const subscription = `sub_ld_${tag}`;
  const events: string[] = [];

  function event(type: string, object: unknown): Stripe.Event {
    const id = `evt_${randomUUID()}`;
    events.push(id);
    return { id, type, data: { object } } as Stripe.Event;
  }

  function paidInvoice(invoiceId: string, balance: { starting: number; ending: number }) {
    const applied = balance.ending - balance.starting;
    return {
      id: invoiceId,
      status: "paid",
      amount_due: 6000 - applied,
      amount_paid: 6000 - applied,
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
    m.balance.mockReset().mockImplementation(async () => ({ id: `cbtxn_${randomUUID()}` }));
    m.intent.mockReset().mockImplementation(async (id: string) => ({
      id,
      payment_method: { id: `pm_${id}`, type: "card" },
      latest_charge: null,
    }));
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `${tag}-owner@example.test`, name: "Owner fixture", role: "OWNER" } });
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Late delivery fixture", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `L${tag.slice(0, 18)}`, stripeCustomerId: `cus_${tag}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "100 Test St", city: "Denver", zip: "80201" } });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        stripeSubscriptionId: subscription,
        billingStartedAt: businessDateFromKey("2026-08-01")!,
        lines: {
          create: {
            label: "Washer/Dryer set",
            monthlyPriceCents: 6000,
            listPriceCents: 6000,
          },
        },
      },
    });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    await prisma.applianceType.create({ data: { id: typeId, name: `Dryer ${tag}`, slug: `dryer-${tag}`, monthlyPriceCents: 3000 } });
    await prisma.appliance.create({ data: { id: washerId, assetNumber: `LW-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
    await prisma.appliance.create({ data: { id: applianceId, assetNumber: `LD-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RESERVED" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: washerId, assignedAt: new Date("2026-07-01T00:00:00Z") } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId, assignedAt: new Date("2026-07-01T00:00:01Z") } });
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "COMPLETED", customerId, agreementId } });
    // A credit from before this rule existed (a referral reward Stripe already used): must never be relabeled.
    await prisma.customerCredit.create({
      data: {
        customerId,
        amountCents: 2500,
        remainingCents: 0,
        reason: "Referral reward",
        sourceType: "REFERRAL",
        sourceId: `ref-${tag}`,
        side: "REFERRER",
        appliedViaStripeAt: new Date("2026-09-01T00:00:00Z"),
        shownCents: 2500,
      },
    });
    // A late-delivery credit already sent to Stripe, waiting to show on the next bill.
    await prisma.customerCredit.create({
      data: {
        customerId,
        amountCents: 1000,
        remainingCents: 0,
        reason: "Credit – Dryer #D-7 delivered late – 10 days",
        sourceType: LATE_DELIVERY_CREDIT_SOURCE,
        sourceId: `pd-${tag}`,
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
    await prisma.providerOperation.deleteMany({ where: { subjectType: "CustomerCredit", subjectId: { in: (await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } })).map((c) => c.id) } } });
    // Line amendments are append-only, so cleanup switches the rule off for its own rows, in one transaction.
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" DISABLE TRIGGER "RentalLineAmendment_append_only"'),
      prisma.rentalLineAmendment.deleteMany({ where: { rentalLine: { agreementId } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" ENABLE TRIGGER "RentalLineAmendment_append_only"'),
    ]);
    await prisma.providerOperation.deleteMany({ where: { subjectType: "RentalLine", idempotencyKey: { startsWith: "subscription-line-reduce-" }, subjectId: { in: (await prisma.rentalLine.findMany({ where: { agreementId }, select: { id: true } })).map((l) => l.id) } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: agreementId }, { entityType: "PendingDelivery" }, { entityType: "CustomerCredit", userId: ownerId }] } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: [applianceId, washerId] } } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: { in: [applianceId, washerId] } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: events } } });
  });

  it("shows the late-delivery credit once as its own line, marks it shown, ignores a replay, and never relabels the old referral credit", async () => {
    // Stripe held -$35.00 of balance ($25 old referral + $10 late delivery) and used all of it on this $60 bill.
    const first = paidInvoice(`in_ld1_${tag}`, { starting: -3500, ending: 0 });
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
    expect(creditLines.map((l) => [l.description, l.amountCents])).toEqual([
      ["Credit – Dryer #D-7 delivered late – 10 days", -1000],
      ["Account credit applied", -2500],
    ]);
    expect(mirrored.subtotalCents).toBe(2500);
    expect(await prisma.invoice.count({ where: { stripeInvoiceId: first.id } })).toBe(1);

    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceType: LATE_DELIVERY_CREDIT_SOURCE } });
    expect(credit.shownCents).toBe(1000);
    expect(credit.shownOnInvoiceId).toBe(mirrored.id);
    const old = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceType: "REFERRAL" } });
    expect(old.shownOnInvoiceId).toBeNull();

    // The following month: no balance used, so no credit line at all.
    const second = paidInvoice(`in_ld2_${tag}`, { starting: 0, ending: 0 });
    m.invoice.mockResolvedValue(second);
    await deliver(event("invoice.paid", second));
    const next = await prisma.invoice.findUniqueOrThrow({ where: { stripeInvoiceId: second.id }, include: { lineItems: true } });
    expect(next.lineItems.filter((line) => line.kind === "CREDIT")).toHaveLength(0);
    expect(next.subtotalCents).toBe(6000);
  });

  it("an item never delivered and taken off the agreement is credited everything billed for it and sent to Stripe", async () => {
    const pending = await prisma.pendingDelivery.create({
      data: {
        agreementId,
        rentalLineId: (await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } })).id,
        applianceId,
        originalJobId: jobId,
        originalDeliveryDate: businessDateFromKey("2026-08-01")!,
      },
    });
    // A $60 set of two: the dryer's share is $30. Billing started Aug 1; by Oct 3 three periods (Aug, Sep, Oct) have been billed.
    await removeUndeliveredItem(ownerId, pending.id, businessDateFromKey("2026-10-03")!);

    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.removedAt).not.toBeNull();
    expect(row.creditId).not.toBeNull();
    const credit = await prisma.customerCredit.findUniqueOrThrow({ where: { id: row.creditId! } });
    expect(credit.amountCents).toBe(9000);
    expect(credit.reason).toBe(`Credit – Dryer ${tag} #LD-${tag.slice(0, 8)} never delivered – 3 months billed`);
    expect(credit.appliedViaStripeAt).not.toBeNull();
    expect(m.balance).toHaveBeenCalledTimes(1);
    expect(m.balance.mock.calls[0][1]).toMatchObject({ amount: -9000, description: credit.reason });

    const appliance = await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } });
    expect(appliance.status).toBe("AVAILABLE");
    const assignment = await prisma.applianceAssignment.findFirstOrThrow({ where: { applianceId } });
    expect(assignment.unassignReason).toBe("Never delivered");

    // Doing it twice is refused, and nothing doubles.
    await expect(removeUndeliveredItem(ownerId, pending.id)).rejects.toThrow(/already/);
    expect(await prisma.customerCredit.count({ where: { customerId, sourceType: LATE_DELIVERY_CREDIT_SOURCE } })).toBe(2);
  });
});
