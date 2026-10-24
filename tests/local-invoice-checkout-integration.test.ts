import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  intentRetrieve: vi.fn(),
  chargeRetrieve: vi.fn(),
  refundCreate: vi.fn(),
  customersCreate: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: m.sessionCreate, list: vi.fn().mockResolvedValue({ data: [] }) } },
    paymentIntents: { retrieve: m.intentRetrieve },
    charges: { retrieve: m.chargeRetrieve },
    refunds: { create: m.refundCreate },
    customers: { create: m.customersCreate, search: vi.fn().mockResolvedValue({ data: [] }) },
  }),
}));

import { prisma } from "@/lib/prisma";
import { processStripeWebhookEvent } from "@/domains/billing/webhooks";
import { createLocalInvoiceCheckout, LocalInvoiceCheckoutError } from "@/domains/billing/local-invoice-checkout";
import { issueInvoiceRefund } from "@/domains/billing/refunds";
import { getPayNowUrl, PayNowError } from "@/domains/portal/pay-now";
import { ensureWalkInCustomer } from "@/domains/sales/walk-in";

// Batch M, M-3 on real Postgres with a FAKE Stripe: card page for a shop sale, and the webhook that records the money.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("card payment for shop sales on real Postgres with a fake Stripe", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 14);
  let ownerId: string;
  const customerUser = `m3-user-${tag}`;
  const otherUser = `m3-other-${tag}`;
  let customerId: string;
  let otherCustomerId: string;
  const invoices: string[] = [];
  let walkInInvoice: string | null = null;
  let n = 0;

  const sale = async (opts: { cents?: number; customer?: string; status?: "OPEN" | "VOID" | "PAID" | "PARTIALLY_PAID"; paid?: number; saleKind?: string | null } = {}) => {
    const id = `m3-inv-${tag}-${n++}`;
    const cents = opts.cents ?? 10_000;
    await prisma.invoice.create({
      data: {
        id, customerId: opts.customer ?? customerId, status: opts.status ?? "OPEN", subtotalCents: cents, amountDueCents: cents, amountPaidCents: opts.paid ?? 0,
        saleKind: opts.saleKind === undefined ? "SHOP_SALE" : opts.saleKind, saleLocation: "PICKUP",
      },
    });
    invoices.push(id);
    return id;
  };

  const event = (type: string, session: Partial<Stripe.Checkout.Session>, id = `evt_${randomUUID()}`) =>
    ({ id, type, created: Math.floor(Date.now() / 1000), data: { object: session } }) as unknown as Stripe.Event;

  const paidSession = (invoiceId: string, cents: number, pi: string, extra: Partial<Stripe.Checkout.Session> = {}): Partial<Stripe.Checkout.Session> => ({
    id: `cs_${randomUUID()}`, object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: pi, amount_total: cents, currency: "usd",
    metadata: { localInvoiceId: invoiceId, localInvoiceCustomerId: undefined as unknown as string, ...(extra.metadata ?? {}) }, ...extra,
  });

  const withCustomer = async (invoiceId: string, s: Partial<Stripe.Checkout.Session>) => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { customerId: true } });
    return { ...s, metadata: { ...(s.metadata as Record<string, string>), localInvoiceCustomerId: inv.customerId } };
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.user.createMany({ data: [
      { id: customerUser, email: `${tag}-c@example.test`, name: "Card Customer", role: "CUSTOMER", emailVerified: true },
      { id: otherUser, email: `${tag}-o@example.test`, name: "Other Customer", role: "CUSTOMER", emailVerified: true },
    ] });
    customerId = (await prisma.customer.create({ data: { userId: customerUser, referralCode: `M3${tag}`.slice(0, 20), stripeCustomerId: `cus_m3_${tag}` } })).id;
    otherCustomerId = (await prisma.customer.create({ data: { userId: otherUser, referralCode: `M4${tag}`.slice(0, 20), stripeCustomerId: `cus_m4_${tag}` } })).id;
  });
  beforeEach(() => {
    m.sessionCreate.mockReset().mockImplementation(async (params: { metadata: Record<string, string> }) => ({ id: `cs_${randomUUID()}`, url: "https://checkout.stripe.test/c/pay", metadata: params.metadata }));
    m.intentRetrieve.mockReset().mockImplementation(async (id: string) => ({ id, payment_method: { type: "card" }, latest_charge: { id: `ch_${id}`, created: 1_790_000_000 } }));
    m.chargeRetrieve.mockReset();
    m.refundCreate.mockReset().mockResolvedValue({ id: `re_${randomUUID()}` });
    m.customersCreate.mockReset().mockResolvedValue({ id: "cus_x" });
  });
  afterAll(async () => {
    const all = [...invoices, ...(walkInInvoice ? [walkInInvoice] : [])];
    const refunds = await prisma.refund.findMany({ where: { invoiceId: { in: all } }, select: { id: true } });
    await prisma.providerOperation.deleteMany({ where: { subjectType: "Refund", subjectId: { in: refunds.map((r) => r.id) } } });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: all } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: all } } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: [customerId, otherCustomerId] } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: [customerId, otherCustomerId] } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: all } } });
    await prisma.invoice.deleteMany({ where: { id: { in: all } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [customerUser, otherUser] } } });
  });

  it("creates a card page for exactly what is owed; asking again returns the same request; a new amount is a new request", async () => {
    const id = await sale({ cents: 12_345 });
    const first = await createLocalInvoiceCheckout({ kind: "desk", userId: ownerId }, id);
    expect(first).toEqual({ url: "https://checkout.stripe.test/c/pay", amountCents: 12_345 });
    const [params, options] = m.sessionCreate.mock.calls[0]!;
    expect(params.line_items[0].price_data.unit_amount).toBe(12_345);
    expect(params.metadata.localInvoiceId).toBe(id);
    expect(params.mode).toBe("payment");
    expect(options.idempotencyKey).toBe(`local-invoice-checkout-${id}-12345-desk`);
    await createLocalInvoiceCheckout({ kind: "desk", userId: ownerId }, id);
    expect(m.sessionCreate.mock.calls[1]![1].idempotencyKey).toBe(options.idempotencyKey);
    await prisma.invoice.update({ where: { id }, data: { amountPaidCents: 2_345, status: "PARTIALLY_PAID" } });
    await createLocalInvoiceCheckout({ kind: "desk", userId: ownerId }, id);
    expect(m.sessionCreate.mock.calls[2]![0].line_items[0].price_data.unit_amount).toBe(10_000);
    expect(m.sessionCreate.mock.calls[2]![1].idempotencyKey).not.toBe(options.idempotencyKey);
  });

  it("refuses cancelled, paid, zero-balance and non-shop-sale invoices, and anyone who is not an active owner or admin", async () => {
    for (const bad of [await sale({ status: "VOID" }), await sale({ status: "PAID", paid: 10_000 }), await sale({ status: "OPEN", paid: 10_000 }), await sale({ saleKind: null })]) {
      await expect(createLocalInvoiceCheckout({ kind: "desk", userId: ownerId }, bad)).rejects.toBeInstanceOf(LocalInvoiceCheckoutError);
    }
    expect(m.sessionCreate).not.toHaveBeenCalled();
    await expect(createLocalInvoiceCheckout({ kind: "desk", userId: customerUser }, await sale())).rejects.toThrow();
  });

  it("the portal only opens a customer's own sale; a walk-in sale has no portal payment, but the desk can take it", async () => {
    const mine = await sale();
    const theirs = await sale({ customer: otherCustomerId });
    await expect(getPayNowUrl(customerUser, mine)).resolves.toBe("https://checkout.stripe.test/c/pay");
    await expect(getPayNowUrl(customerUser, theirs)).rejects.toBeInstanceOf(PayNowError);
    await expect(getPayNowUrl(otherUser, mine)).rejects.toBeInstanceOf(PayNowError);
    const walk = await prisma.$transaction((tx) => ensureWalkInCustomer(tx));
    walkInInvoice = await sale({ customer: walk.customerId });
    await expect(getPayNowUrl(walk.userId, walkInInvoice)).rejects.toBeInstanceOf(PayNowError);
    m.sessionCreate.mockClear();
    await createLocalInvoiceCheckout({ kind: "desk", userId: ownerId }, walkInInvoice);
    expect(m.sessionCreate.mock.calls[0]![0].customer).toBeUndefined(); // no Stripe customer for a walk-in
    invoices.push(walkInInvoice);
    walkInInvoice = null;
  });

  it("a paid session pays the sale once; the same event or the same payment again changes nothing", async () => {
    const id = await sale({ cents: 8_000 });
    const pi = `pi_${randomUUID()}`;
    const session = await withCustomer(id, paidSession(id, 8_000, pi));
    const e = event("checkout.session.completed", session);
    await processStripeWebhookEvent(e);
    await processStripeWebhookEvent(e); // same delivery again
    await processStripeWebhookEvent(event("checkout.session.completed", session)); // a different event, same money
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    expect(inv.status).toBe("PAID");
    expect(inv.amountPaidCents).toBe(8_000);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]!.stripePaymentIntentId).toBe(pi);
    expect(await prisma.receipt.count({ where: { customerId, stripeChargeId: `ch_${pi}` } })).toBe(1);
  });

  it("bank payments count only when Stripe says they cleared, and a failed one records no money", async () => {
    const id = await sale({ cents: 5_000 });
    const pi = `pi_${randomUUID()}`;
    const unpaid = await withCustomer(id, paidSession(id, 5_000, pi, { payment_status: "unpaid" }));
    await processStripeWebhookEvent(event("checkout.session.completed", unpaid));
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).amountPaidCents).toBe(0);
    const cleared = await withCustomer(id, paidSession(id, 5_000, pi));
    await processStripeWebhookEvent(event("checkout.session.async_payment_succeeded", cleared));
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");

    const failedId = await sale({ cents: 5_000 });
    const failed = await withCustomer(failedId, paidSession(failedId, 5_000, `pi_${randomUUID()}`, { payment_status: "unpaid" }));
    await processStripeWebhookEvent(event("checkout.session.async_payment_failed", failed));
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: failedId } });
    expect(row.amountPaidCents).toBe(0);
    expect(row.status).toBe("OPEN");
    expect(await prisma.auditLog.count({ where: { entityId: failedId, action: "sale.card_payment_failed" } })).toBe(1);
  });

  it("money that arrives after the sale was cancelled is held for the owner: the sale stays cancelled and nothing is lost or applied", async () => {
    const id = await sale({ cents: 6_000 });
    await prisma.invoice.update({ where: { id }, data: { status: "VOID" } });
    const pi = `pi_${randomUUID()}`;
    await processStripeWebhookEvent(event("checkout.session.completed", await withCustomer(id, paidSession(id, 6_000, pi))));
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    expect(inv.status).toBe("VOID");
    expect(inv.amountPaidCents).toBe(0);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]!.status).toBe("held");
    expect(await prisma.receipt.count({ where: { customerId, stripeChargeId: `ch_${pi}`, amountCents: 6_000 } })).toBe(1);
    expect(await prisma.customerCredit.count({ where: { customerId, amountCents: 6_000 } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "billing.payment_on_closed_invoice" } })).toBe(1);
  });

  it("if less is owed by the time the money arrives, only that is applied and the extra becomes account credit", async () => {
    const id = await sale({ cents: 10_000 });
    await prisma.invoice.update({ where: { id }, data: { amountPaidCents: 7_000, status: "PARTIALLY_PAID" } }); // cash taken meanwhile
    await processStripeWebhookEvent(event("checkout.session.completed", await withCustomer(id, paidSession(id, 10_000, `pi_${randomUUID()}`))));
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv.status).toBe("PAID");
    expect(inv.amountPaidCents).toBe(10_000);
    const credits = await prisma.customerCredit.findMany({ where: { customerId, sourceType: "RECEIPT_OVERPAYMENT" } });
    expect(credits.some((c) => c.amountCents === 7_000)).toBe(true);
  });

  it("a walk-in's overpayment is held for the owner, never turned into shared account credit", async () => {
    const walk = await prisma.$transaction((tx) => ensureWalkInCustomer(tx));
    const id = await sale({ cents: 10_000, customer: walk.customerId });
    await prisma.invoice.update({ where: { id }, data: { amountPaidCents: 7_000, status: "PARTIALLY_PAID" } }); // cash taken meanwhile
    const pi = `pi_${randomUUID()}`;
    const session = await withCustomer(id, paidSession(id, 10_000, pi));
    await processStripeWebhookEvent(event("checkout.session.completed", session));
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    expect(inv.amountPaidCents).toBe(7_000);
    expect(inv.payments.map((p) => p.status)).toEqual(["held"]);
    expect(await prisma.customerCredit.count({ where: { customerId: walk.customerId, sourceType: "RECEIPT_OVERPAYMENT", amountCents: { in: [3_000, 10_000] } } })).toBe(0);
    await prisma.payment.deleteMany({ where: { invoiceId: id } });
    await prisma.receipt.deleteMany({ where: { stripeChargeId: `ch_${pi}` } });
  });

  it("a payment naming a different customer's sale is refused and records nothing", async () => {
    const id = await sale();
    const bad = paidSession(id, 10_000, `pi_${randomUUID()}`, { metadata: { localInvoiceId: id, localInvoiceCustomerId: otherCustomerId } });
    await expect(processStripeWebhookEvent(event("checkout.session.completed", bad))).rejects.toThrow(/does not match/);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).amountPaidCents).toBe(0);
  });

  it("a card payment on a shop sale can be refunded through the normal refund path, against the same Stripe charge", async () => {
    const id = await sale({ cents: 9_000 });
    const pi = `pi_${randomUUID()}`;
    await processStripeWebhookEvent(event("checkout.session.completed", await withCustomer(id, paidSession(id, 9_000, pi))));
    await issueInvoiceRefund(ownerId, { invoiceId: id, amountCents: 4_000, reason: "GOODWILL", notes: "returned one item" });
    expect(m.refundCreate).toHaveBeenCalledTimes(1);
    expect(m.refundCreate).toHaveBeenCalledWith(expect.objectContaining({ charge: `ch_${pi}`, amount: 4_000 }), expect.any(Object));
  });
});
