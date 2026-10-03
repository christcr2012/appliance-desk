import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({ refund: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ refunds: { create: stripeMock.refund } }),
}));

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { detectDrift } from "@/domains/billing/reconciliation";
import { holdReceiptForClosedInvoice } from "@/domains/billing/ledger";
import {
  listHeldPayments,
  listHeldRefundsWaitingOnStripe,
  resolveHeldPaymentAsCredit,
  resolveHeldPaymentAsPaid,
} from "@/domains/billing/held-payments";
import { refundHeldPayment } from "@/domains/billing/refunds";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("settling a held payment: mark paid, keep as credit, refund", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `hp-owner-${tag}`;
  const staffId = `hp-staff-${tag}`;
  const userId = `hp-user-${tag}`;
  const customerId = `hp-customer-${tag}`;
  const invoiceIds: string[] = [];
  const eventIds: string[] = [];
  const intentOf = new Map<string, string>();

  async function held(opts: { invoiceStatus?: "WRITTEN_OFF" | "VOID"; paidCents?: number; chargeId?: string | null } = {}) {
    const invoiceId = `hp-invoice-${randomUUID()}`;
    invoiceIds.push(invoiceId);
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        customerId,
        status: opts.invoiceStatus ?? "WRITTEN_OFF",
        subtotalCents: 10_000,
        amountDueCents: 10_000,
        amountPaidCents: opts.paidCents ?? 0,
        writtenOffAt: new Date(),
        writtenOffReason: "Tenant vacated",
      },
    });
    const chargeId = opts.chargeId === undefined ? `ch_${randomUUID()}` : opts.chargeId;
    const { receiptId } = await prisma.$transaction((tx) =>
      holdReceiptForClosedInvoice(tx, {
        customerId,
        invoiceId,
        amountCents: 10_000,
        method: "card",
        receivedOn: new Date(),
        stripeChargeId: chargeId,
        stripePaymentIntentId: `pi_${randomUUID()}`,
      }),
    );
    const payment = await prisma.payment.findFirstOrThrow({ where: { receiptId } });
    intentOf.set(payment.id, payment.stripePaymentIntentId!);
    return { invoiceId, receiptId, paymentId: payment.id, chargeId: chargeId!, intentId: payment.stripePaymentIntentId! };
  }

  beforeEach(() => {
    stripeMock.refund.mockReset();
    stripeMock.refund.mockImplementation(async () => ({ id: `re_${randomUUID()}` }));
  });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "HP Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `${tag}-s@example.test`, name: "HP Staff", role: "STAFF", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "HP Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `H${tag.slice(0, 18)}` } });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Payment", action: "billing.held_credit_refunded_in_stripe" } });
    const refundIds = (await prisma.refund.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.providerOperation.deleteMany({ where: { subjectType: "Refund", subjectId: { in: refundIds } } });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, userId] } } });
  });

  it("lists it with the recommended choice: mark paid for a written-off invoice, refund for a cancelled one", async () => {
    const a = await held();
    const b = await held({ invoiceStatus: "VOID" });
    const list = await listHeldPayments();
    const ra = list.find((x) => x.id === a.paymentId)!;
    const rb = list.find((x) => x.id === b.paymentId)!;
    expect(ra.recommendation.option).toBe("MARK_PAID");
    expect(ra.options).toEqual(["MARK_PAID", "CREDIT", "REFUND"]);
    expect(rb.recommendation.option).toBe("REFUND");
    expect(rb.options).toEqual(["CREDIT", "REFUND"]);
  });

  it("mark paid: reverses the write-off, applies the money to the invoice, once", async () => {
    const h = await held();
    await resolveHeldPaymentAsPaid(ownerId, h.paymentId);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: h.invoiceId } });
    expect(invoice).toMatchObject({ status: "PAID", amountPaidCents: 10_000, writtenOffAt: null });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("succeeded");
    expect(await prisma.customerCredit.count({ where: { sourceId: h.receiptId } })).toBe(0);
    await expect(resolveHeldPaymentAsPaid(ownerId, h.paymentId)).rejects.toThrow(/already been dealt with/);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: h.invoiceId } })).amountPaidCents).toBe(10_000);
  });

  it("mark paid when part of the invoice was already paid: applies what is owed, the rest becomes credit", async () => {
    const h = await held({ paidCents: 4_000 });
    await resolveHeldPaymentAsPaid(ownerId, h.paymentId);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: h.invoiceId } });
    expect(invoice).toMatchObject({ status: "PAID", amountPaidCents: 10_000 });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } });
    expect(payment.amountCents).toBe(6_000);
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { sourceId: h.receiptId } });
    expect(credit.amountCents).toBe(4_000);
  });

  it("will not mark a cancelled (void) invoice paid", async () => {
    const h = await held({ invoiceStatus: "VOID" });
    await expect(resolveHeldPaymentAsPaid(ownerId, h.paymentId)).rejects.toThrow(/Only a written-off invoice/);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held");
  });

  it("credit: creates spendable credit for the full amount, leaves the invoice written off, once", async () => {
    const h = await held();
    await resolveHeldPaymentAsCredit(ownerId, h.paymentId);
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { sourceType: "HELD_PAYMENT", sourceId: h.paymentId } });
    expect(credit).toMatchObject({ amountCents: 10_000, remainingCents: 10_000, customerId });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: h.invoiceId } })).status).toBe("WRITTEN_OFF");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held_to_credit");
    await expect(resolveHeldPaymentAsCredit(ownerId, h.paymentId)).rejects.toThrow(/already been dealt with/);
    expect(await prisma.customerCredit.count({ where: { sourceType: "HELD_PAYMENT", sourceId: h.paymentId } })).toBe(1);
  });

  it("two simultaneous decisions on one held payment settle it exactly once", async () => {
    const h = await held();
    const results = await Promise.allSettled([
      resolveHeldPaymentAsCredit(ownerId, h.paymentId),
      resolveHeldPaymentAsPaid(ownerId, h.paymentId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const credits = await prisma.customerCredit.count({ where: { sourceId: { in: [h.paymentId, h.receiptId] } } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: h.invoiceId } });
    // Either the credit exists or the invoice was paid: never both, never twice.
    expect((credits > 0 ? 1 : 0) + (invoice.amountPaidCents > 0 ? 1 : 0)).toBe(1);
  });

  it("refund: sends the whole payment back through Stripe and records it", async () => {
    const h = await held();
    const { refundId } = await refundHeldPayment(ownerId, h.paymentId);
    expect(stripeMock.refund).toHaveBeenCalledTimes(1);
    expect(stripeMock.refund.mock.calls[0]![0]).toMatchObject({ amount: 10_000 });
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    expect(refund).toMatchObject({ amountCents: 10_000, invoiceId: h.invoiceId });
    expect(refund.stripeRefundId).toMatch(/^re_/);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held_refunded");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: h.invoiceId } })).status).toBe("WRITTEN_OFF");
    await expect(refundHeldPayment(ownerId, h.paymentId)).rejects.toThrow(/already been dealt with/);
    expect(stripeMock.refund).toHaveBeenCalledTimes(1);
  });

  it("a refund that Stripe rejects is still recorded as decided and left for reconciliation", async () => {
    const h = await held();
    stripeMock.refund.mockRejectedValueOnce(Object.assign(new Error("down"), { type: "StripeConnectionError" }));
    const { refundId } = await refundHeldPayment(ownerId, h.paymentId);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundId } })).stripeRefundId).toBeNull();
    const op = await prisma.providerOperation.findFirstOrThrow({ where: { subjectType: "Refund", subjectId: refundId } });
    expect(op.status).toBe("UNKNOWN");
  });

  it("cannot refund a payment that did not come through Stripe", async () => {
    const h = await held({ chargeId: null });
    await expect(refundHeldPayment(ownerId, h.paymentId)).rejects.toThrow(/can't be refunded to a card/);
    expect((await listHeldPayments()).find((x) => x.id === h.paymentId)!.options).toEqual(["MARK_PAID", "CREDIT"]);
  });

  it("staff cannot settle a held payment", async () => {
    const h = await held();
    await expect(resolveHeldPaymentAsCredit(staffId, h.paymentId)).rejects.toThrow();
    await expect(resolveHeldPaymentAsPaid(staffId, h.paymentId)).rejects.toThrow();
    await expect(refundHeldPayment(staffId, h.paymentId)).rejects.toThrow();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held");
  });

  async function stripeRefund(h: { chargeId: string; intentId: string }, refundedCents: number) {
    const id = `evt_${randomUUID()}`;
    eventIds.push(id);
    await processStripeWebhookEvent({
      id,
      type: "charge.refunded",
      data: { object: { id: h.chargeId, payment_intent: h.intentId, amount_refunded: refundedCents, refunds: { data: [{ id: `re_${randomUUID()}` }] } } },
    } as unknown as Stripe.Event);
  }

  it("a partial refund in Stripe leaves only the rest held, and every option then works on the rest", async () => {
    const h = await held();
    await stripeRefund(h, 4_000);
    const rows = await prisma.payment.findMany({ where: { receiptId: h.receiptId }, orderBy: { amountCents: "asc" } });
    expect(rows.map((r) => [r.status, r.amountCents])).toEqual([["held_refunded", 4_000], ["held", 6_000]]);
    await resolveHeldPaymentAsCredit(ownerId, h.paymentId);
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { sourceType: "HELD_PAYMENT", sourceId: h.paymentId } });
    expect(credit.amountCents).toBe(6_000);
  });

  it("a full refund in Stripe settles it, and the screen stops asking about it", async () => {
    const h = await held();
    await stripeRefund(h, 10_000);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held_refunded");
    expect((await listHeldPayments()).some((x) => x.id === h.paymentId)).toBe(false);
  });

  it("a Stripe refund after the owner kept the money as unspent credit withdraws that credit", async () => {
    const h = await held();
    await resolveHeldPaymentAsCredit(ownerId, h.paymentId);
    await stripeRefund(h, 10_000);
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { sourceType: "HELD_PAYMENT", sourceId: h.paymentId } });
    expect(credit.remainingCents).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held_refunded");
  });

  it("a Stripe refund after the credit was partly used is flagged for the owner instead of hidden", async () => {
    const h = await held();
    await resolveHeldPaymentAsCredit(ownerId, h.paymentId);
    await prisma.customerCredit.updateMany({ where: { sourceType: "HELD_PAYMENT", sourceId: h.paymentId }, data: { remainingCents: 7_000 } });
    await stripeRefund(h, 10_000);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: h.paymentId } })).status).toBe("held_conflict");
    const drift = await detectDrift();
    expect(drift.some((r) => r.kind === "HELD_PAYMENT" && r.subjectId === h.paymentId && /partly used/.test(r.detail))).toBe(true);
  });

  it("an owner decision and a Stripe refund at the same moment never leave both the credit and the refund standing", async () => {
    const h = await held();
    await Promise.allSettled([resolveHeldPaymentAsCredit(ownerId, h.paymentId), stripeRefund(h, 10_000)]);
    const credit = await prisma.customerCredit.findFirst({ where: { sourceType: "HELD_PAYMENT", sourceId: h.paymentId } });
    const refunds = await prisma.refund.count({ where: { invoiceId: h.invoiceId } });
    expect(refunds).toBe(1);
    expect(credit?.remainingCents ?? 0).toBe(0);
  });

  it("a refund the card processor has not confirmed is listed as waiting", async () => {
    const h = await held();
    stripeMock.refund.mockRejectedValueOnce(Object.assign(new Error("down"), { type: "StripeConnectionError" }));
    const result = await refundHeldPayment(ownerId, h.paymentId);
    expect(result.outcome).toBe("UNKNOWN");
    expect((await listHeldRefundsWaitingOnStripe()).some((x) => x.id === h.paymentId)).toBe(true);
    const ok = await held();
    const done = await refundHeldPayment(ownerId, ok.paymentId);
    expect(done.outcome).toBe("SUCCEEDED");
    expect((await listHeldRefundsWaitingOnStripe()).some((x) => x.id === ok.paymentId)).toBe(false);
  });
});
