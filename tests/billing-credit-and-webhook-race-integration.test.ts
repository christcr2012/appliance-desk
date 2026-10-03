import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ intent: vi.fn(), invoice: vi.fn() }));
// No network: the only Stripe calls the paid-invoice path makes are these two
// retrieves, so they are faked here.
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    paymentIntents: { retrieve: m.intent },
    invoices: { retrieve: m.invoice },
    charges: { retrieve: vi.fn() },
  }),
}));

import { prisma } from "@/lib/prisma";
import { applyCreditToInvoice } from "@/domains/billing/ledger";
import { writeOffInvoice } from "@/domains/billing/manual-payments";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("credit application and paid-vs-write-off races in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `cr-user-${tag}`;
  const ownerId = `cr-owner-${tag}`;
  const customerId = `cr-customer-${tag}`;
  const addressId = `cr-address-${tag}`;
  const creditIds: string[] = [];
  const invoiceIds: string[] = [];
  const agreementIds: string[] = [];
  const eventIds: string[] = [];

  async function newCredit(cents: number) {
    const id = `cr-credit-${randomUUID()}`;
    creditIds.push(id);
    await prisma.customerCredit.create({
      data: {
        id,
        customerId,
        amountCents: cents,
        remainingCents: cents,
        reason: "Race test credit",
      },
    });
    return id;
  }

  async function newInvoice(extra: { stripeInvoiceId?: string; agreementId?: string } = {}) {
    const id = `cr-invoice-${randomUUID()}`;
    invoiceIds.push(id);
    await prisma.invoice.create({
      data: {
        id,
        customerId,
        status: "OPEN",
        subtotalCents: 10_000,
        amountDueCents: 10_000,
        amountPaidCents: 0,
        ...extra,
      },
    });
    return id;
  }

  const applyInOwnTx = (creditId: string, invoiceId: string, amountCents: number) =>
    prisma.$transaction(
      (tx) => applyCreditToInvoice(tx, { creditId, invoiceId, amountCents, appliedByUserId: ownerId }),
      { maxWait: 15_000, timeout: 20_000 },
    );

  function expectCleanFailure(reason: unknown) {
    const text = String(reason);
    expect(text).toMatch(/does not have enough remaining balance/i);
    // A deadlock or serialization failure would surface as one of these.
    expect(text).not.toMatch(/deadlock|40P01|40001|could not serialize/i);
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, email: `${tag}-c@example.test`, name: "Race Customer", role: "CUSTOMER", emailVerified: true },
        { id: ownerId, email: `${tag}-o@example.test`, name: "Race Owner", role: "OWNER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `C${tag.slice(0, 18)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Race St", city: "Greeley", zip: "80631" },
    });
    m.intent.mockImplementation(async (id: string) => ({
      id,
      payment_method: { id: `pm_${id}`, type: "card" },
      latest_charge: null,
    }));
  });

  afterAll(async () => {
    await prisma.creditApplication.deleteMany({ where: { creditId: { in: creditIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
    await prisma.webhookEvent.deleteMany({ where: { id: { in: eventIds } } });
  });

  async function assertCreditConsistent(creditId: string, originalCents: number) {
    const credit = await prisma.customerCredit.findUniqueOrThrow({ where: { id: creditId } });
    const apps = await prisma.creditApplication.findMany({ where: { creditId } });
    const applied = apps.reduce((sum, row) => sum + row.amountCents, 0);
    expect(credit.remainingCents).toBeGreaterThanOrEqual(0);
    expect(applied).toBeLessThanOrEqual(originalCents);
    expect(credit.remainingCents + applied).toBe(originalCents);
    return { credit, apps, applied };
  }

  it("two simultaneous applications that together exceed the credit: exactly one wins", async () => {
    const creditId = await newCredit(1_000);
    const invoiceId = await newInvoice();

    const results = await Promise.allSettled([
      applyInOwnTx(creditId, invoiceId, 600),
      applyInOwnTx(creditId, invoiceId, 600),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expectCleanFailure(failed[0].reason);

    const { credit, applied } = await assertCreditConsistent(creditId, 1_000);
    expect(applied).toBe(600);
    expect(credit.remainingCents).toBe(400);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.amountPaidCents).toBe(applied);
    expect(invoice.status).toBe("PARTIALLY_PAID");
    const lines = await prisma.invoiceLineItem.findMany({ where: { invoiceId, kind: "CREDIT" } });
    expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(-applied);
  });

  it("ten simultaneous applications against one small credit never overspend it", async () => {
    const creditId = await newCredit(1_000);
    const invoiceId = await newInvoice();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => applyInOwnTx(creditId, invoiceId, 300)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(3); // floor(1000 / 300)
    expect(failed).toHaveLength(7);
    for (const f of failed) expectCleanFailure(f.reason);

    const { credit, apps, applied } = await assertCreditConsistent(creditId, 1_000);
    expect(apps).toHaveLength(3);
    expect(applied).toBe(900);
    expect(credit.remainingCents).toBe(100);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.amountPaidCents).toBe(applied);
    expect(invoice.version).toBe(1 + 3);
  });

  it("ten racers whose amounts exactly drain the credit leave it at zero, never negative", async () => {
    const creditId = await newCredit(1_000);
    const invoiceId = await newInvoice();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => applyInOwnTx(creditId, invoiceId, 100)),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const { credit, apps } = await assertCreditConsistent(creditId, 1_000);
    expect(apps).toHaveLength(10);
    expect(credit.remainingCents).toBe(0);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.amountPaidCents).toBe(1_000);

    // One more after it is empty is a clean failure.
    await expect(applyInOwnTx(creditId, invoiceId, 100)).rejects.toThrow(/enough remaining balance/i);
  });

  it("two different invoices racing for the same credit: credit is split consistently across both", async () => {
    const creditId = await newCredit(1_000);
    const invoiceA = await newInvoice();
    const invoiceB = await newInvoice();

    const results = await Promise.allSettled([
      applyInOwnTx(creditId, invoiceA, 600),
      applyInOwnTx(creditId, invoiceB, 600),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expectCleanFailure(failed[0].reason);

    const { credit, apps, applied } = await assertCreditConsistent(creditId, 1_000);
    expect(apps).toHaveLength(1);
    expect(applied).toBe(600);
    expect(credit.remainingCents).toBe(400);

    const [a, b] = await Promise.all([
      prisma.invoice.findUniqueOrThrow({ where: { id: invoiceA } }),
      prisma.invoice.findUniqueOrThrow({ where: { id: invoiceB } }),
    ]);
    for (const inv of [a, b]) {
      const forInvoice = apps.filter((row) => row.invoiceId === inv.id).reduce((s, r) => s + r.amountCents, 0);
      expect(inv.amountPaidCents).toBe(forInvoice);
    }
    expect(a.amountPaidCents + b.amountPaidCents).toBe(applied);
  });

  it("many invoices racing for one credit with small slices: totals reconcile per invoice", async () => {
    const creditId = await newCredit(1_000);
    const invs = await Promise.all(Array.from({ length: 5 }, () => newInvoice()));
    const jobs = invs.flatMap((id) => [applyInOwnTx(creditId, id, 250), applyInOwnTx(creditId, id, 250)]);
    const results = await Promise.allSettled(jobs);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(4); // 1000 / 250
    for (const r of results) if (r.status === "rejected") expectCleanFailure(r.reason);

    const { credit, apps, applied } = await assertCreditConsistent(creditId, 1_000);
    expect(applied).toBe(1_000);
    expect(credit.remainingCents).toBe(0);
    for (const id of invs) {
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      const forInvoice = apps.filter((row) => row.invoiceId === id).reduce((s, r) => s + r.amountCents, 0);
      expect(inv.amountPaidCents).toBe(forInvoice);
    }
  });

  it("a Stripe invoice.paid event racing a write-off yields exactly one consistent terminal state (20 rounds)", async () => {
    const outcomes = { paid: 0, writtenOff: 0 };

    for (let round = 0; round < 20; round += 1) {
      const subscription = `sub_${tag}_${round}`;
      const stripeInvoiceId = `in_${tag}_${round}`;
      const agreementId = `cr-agreement-${randomUUID()}`;
      agreementIds.push(agreementId);
      await prisma.rentalAgreement.create({
        data: {
          id: agreementId,
          customerId,
          serviceAddressId: addressId,
          status: "ACTIVE",
          stripeSubscriptionId: subscription,
        },
      });
      const invoiceId = await newInvoice({ stripeInvoiceId, agreementId });

      const stripeInvoice = {
        id: stripeInvoiceId,
        status: "paid",
        amount_due: 10_000,
        amount_paid: 10_000,
        parent: { subscription_details: { subscription } },
        total_taxes: [],
        payments: { data: [{ payment: { payment_intent: `pi_${tag}_${round}` } }] },
        lines: { data: [{ description: "Washer", amount: 10_000 }] },
      };
      m.invoice.mockResolvedValue(stripeInvoice);
      const eventId = `evt_${tag}_${round}`;
      eventIds.push(eventId);
      const event = { id: eventId, type: "invoice.paid", data: { object: stripeInvoice } } as unknown as Stripe.Event;

      // Alternate who is launched first so both orderings of lock acquisition get exercised.
      const launchPaidFirst = round % 2 === 0;
      const start = (which: "paid" | "off") =>
        which === "paid"
          ? processStripeWebhookEvent(event)
          : writeOffInvoice(invoiceId, ownerId, `Race round ${round}`);
      const order: Array<"paid" | "off"> = launchPaidFirst ? ["paid", "off"] : ["off", "paid"];
      const settled = await Promise.allSettled(order.map(start));
      const byName = Object.fromEntries(order.map((name, i) => [name, settled[i]]));

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const payments = await prisma.payment.findMany({ where: { invoiceId, status: "succeeded" } });
      const receipts = await prisma.receipt.findMany({ where: { payments: { some: { invoiceId, status: "succeeded" } } } });
      const paymentTotal = payments.reduce((s, p) => s + p.amountCents, 0);
      const ctx = `round ${round} (${launchPaidFirst ? "paid first" : "write-off first"}): ` +
        JSON.stringify({ status: invoice.status, paid: invoice.amountPaidCents, off: invoice.writtenOffAt, byName });

      // Invariants that must hold regardless of who won.
      expect(invoice.status === "PAID" || invoice.status === "WRITTEN_OFF", ctx).toBe(true);
      expect(invoice.amountPaidCents, ctx).toBe(paymentTotal);
      expect(payments.length, ctx).toBe(receipts.length);

      if (invoice.status === "PAID") {
        outcomes.paid += 1;
        expect(invoice.amountPaidCents, ctx).toBe(10_000);
        expect(payments, ctx).toHaveLength(1);
        expect(receipts, ctx).toHaveLength(1);
        expect(invoice.writtenOffAt, ctx).toBeNull();
        expect(byName.paid.status, ctx).toBe("fulfilled");
        expect(byName.off.status, ctx).toBe("rejected");
      } else {
        outcomes.writtenOff += 1;
        expect(invoice.writtenOffAt, ctx).not.toBeNull();
        // Nothing may have settled a written-off invoice.
        expect(invoice.amountPaidCents, ctx).toBe(0);
        expect(payments, ctx).toHaveLength(0);
        expect(receipts, ctx).toHaveLength(0);
        expect(byName.off.status, ctx).toBe("fulfilled");
        // The card payment is real money: it must be on the books as a held receipt (not applied
        // to the closed invoice, and not turned into spendable credit), with a review note.
        const held = await prisma.payment.findMany({ where: { invoiceId, status: "held" } });
        expect(held, ctx).toHaveLength(1);
        expect(held[0].amountCents, ctx).toBe(10_000);
        expect(held[0].receiptId, ctx).not.toBeNull();
        expect(
          await prisma.customerCredit.count({ where: { sourceId: held[0].receiptId! } }),
          ctx,
        ).toBe(0);
        expect(
          await prisma.auditLog.count({
            where: { action: "billing.payment_on_closed_invoice", entityId: invoiceId },
          }),
          ctx,
        ).toBe(1);
        expect(byName.paid.status, ctx).toBe("fulfilled");
      }
    }
    // Sanity: both writers actually ran in every round.
    expect(outcomes.paid + outcomes.writtenOff).toBe(20);
  }, 120_000);

  it("a card payment on a written-off invoice is held (not spendable), recorded once, and a Stripe refund of it is recorded", async () => {
    const subscription = `sub_${tag}_held`;
    const stripeInvoiceId = `in_${tag}_held`;
    const chargeId = `ch_${tag}_held`;
    const intentId = `pi_${tag}_held`;
    const agreementId = `cr-agreement-${randomUUID()}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({
      data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE", stripeSubscriptionId: subscription },
    });
    const invoiceId = await newInvoice({ stripeInvoiceId, agreementId });
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "WRITTEN_OFF", writtenOffAt: new Date() },
    });
    m.intent.mockImplementation(async (id: string) => ({
      id,
      payment_method: { id: `pm_${id}`, type: "card" },
      latest_charge: { id: chargeId, created: Math.floor(Date.now() / 1000) },
    }));
    try {
      const stripeInvoice = {
        id: stripeInvoiceId,
        status: "paid",
        amount_due: 10_000,
        amount_paid: 10_000,
        parent: { subscription_details: { subscription } },
        total_taxes: [],
        payments: { data: [{ payment: { payment_intent: intentId } }] },
        lines: { data: [{ description: "Washer", amount: 10_000 }] },
      };
      m.invoice.mockResolvedValue(stripeInvoice);
      const paidEvent = (id: string) => {
        eventIds.push(id);
        return { id, type: "invoice.paid", data: { object: stripeInvoice } } as unknown as Stripe.Event;
      };

      await processStripeWebhookEvent(paidEvent(`evt_${tag}_held_1`));
      // Stripe delivers again under a different event id: still exactly one held receipt.
      await processStripeWebhookEvent(paidEvent(`evt_${tag}_held_2`));

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe("WRITTEN_OFF");
      expect(invoice.amountPaidCents).toBe(0);
      const heldPayments = await prisma.payment.findMany({ where: { invoiceId } });
      expect(heldPayments).toHaveLength(1);
      expect(heldPayments[0]).toMatchObject({ status: "held", amountCents: 10_000, stripePaymentIntentId: intentId });
      const receipts = await prisma.receipt.findMany({ where: { stripeChargeId: chargeId } });
      expect(receipts).toHaveLength(1);
      // Not spendable: no credit exists for it until the owner decides (IN-23).
      expect(await prisma.customerCredit.count({ where: { sourceId: receipts[0].id } })).toBe(0);

      // Stripe later refunds that charge: the refund must find the held payment.
      eventIds.push(`evt_${tag}_held_refund`);
      await processStripeWebhookEvent({
        id: `evt_${tag}_held_refund`,
        type: "charge.refunded",
        data: { object: { id: chargeId, payment_intent: intentId, amount_refunded: 10_000, refunds: { data: [{ id: `re_${tag}` }] } } },
      } as unknown as Stripe.Event);
      const refunds = await prisma.refund.findMany({ where: { invoiceId } });
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amountCents).toBe(10_000);
      expect(await prisma.customerCredit.count({ where: { sourceId: receipts[0].id } })).toBe(0);
      await prisma.refund.deleteMany({ where: { invoiceId } });
    } finally {
      m.intent.mockImplementation(async (id: string) => ({
        id,
        payment_method: { id: `pm_${id}`, type: "card" },
        latest_charge: null,
      }));
    }
  });
});
