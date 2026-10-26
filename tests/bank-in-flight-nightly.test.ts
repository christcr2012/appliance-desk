import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// BILL-1 on real Postgres with a FAKE Stripe: the nightly check, "Record it now", the late-fee rule and the To do item.
const m = vi.hoisted(() => ({
  intents: new Map<string, { status: string } | "error">(),
  invoices: new Map<string, unknown>(),
  sessions: new Map<string, unknown>(),
  slowDays: 6,
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    paymentIntents: {
      retrieve: async (id: string) => {
        const state = m.intents.get(id) ?? { status: "processing" };
        if (state === "error") throw new Error("Stripe is down");
        return { id, status: state.status, payment_method_types: ["us_bank_account"], payment_method: { id: `pm_${id}`, type: "us_bank_account" }, latest_charge: null };
      },
    },
    invoicePayments: { list: async () => ({ data: [] }) },
    invoices: { retrieve: async (id: string) => m.invoices.get(id) },
    checkout: { sessions: { list: async (params: { payment_intent: string }) => ({ data: m.sessions.has(params.payment_intent) ? [m.sessions.get(params.payment_intent)] : [] }) } },
    subscriptions: { retrieve: async () => ({}) },
    charges: { retrieve: async () => ({}) },
  }),
}));
vi.mock("@/lib/session", () => ({ requireRole: async () => ({ user: { id: "viewer", role: "OWNER" } }) }));
vi.mock("@/domains/settings", () => ({ getBusinessSettings: async () => ({ bankPaymentSlowBusinessDays: m.slowDays }) }));

import { prisma } from "@/lib/prisma";
import { checkBankPaymentsInFlight, recoverBankSettlement } from "@/domains/billing/in-flight-check";
import { runLateFees as runLateFeesAll } from "@/domains/billing/late-fee-engine";
import { pastDueTodoWhere } from "@/domains/exceptions";
import { listBankPaymentSlow } from "@/domains/exceptions/bank-payment-attention";
import { bankPaymentSlowException } from "@/domains/exceptions/rules";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe("bankPaymentSlowException (pure)", () => {
  const base = { id: "r1", customerId: "c", invoiceId: "i", customerName: "Pat", amountCents: 4000, startedAt: new Date("2026-10-01T12:00:00Z"), bankingDaysOld: 7, settledInStripeAt: null };
  it("is a calm medium item that never calls the customer late", () => {
    const item = bankPaymentSlowException(base);
    expect(item).toMatchObject({ category: "BANK_PAYMENT_SLOW", severity: "medium", amountCents: 4000, href: "/desk/billing/reconciliation?payment=r1" });
    expect(item.action).toBeUndefined();
    expect(item.detail).not.toMatch(/late|past due/i);
  });
  it("gives two payments with the same name and amount different identities", async () => {
    const { todoKey } = await import("@/domains/exceptions/todo");
    const a = bankPaymentSlowException(base);
    const b = bankPaymentSlowException({ ...base, id: "r2" });
    expect(a.title).toBe(b.title);
    expect(todoKey(a)).not.toBe(todoKey(b));
  });
  it("is high with a Record it now button once Stripe says it cleared", () => {
    const item = bankPaymentSlowException({ ...base, settledInStripeAt: new Date() });
    expect(item).toMatchObject({ severity: "high", action: { type: "RECORD_BANK_PAYMENT", id: "r1", label: "Record it now" } });
  });
});

describe.skipIf(!enabled)("bank payments being confirmed — nightly check, recovery, late fees, To do (real Postgres, fake Stripe)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const userId = `bn-user-${tag}`;
  const adminId = `bn-admin-${tag}`;
  const demotedId = `bn-demoted-${tag}`;
  const customerId = `bn-customer-${tag}`;
  // Limited to this file's own customer: other test files share the database and run at the same time.
  const runLateFees = (at?: Date) => runLateFeesAll(at, { customerIds: [customerId] });
  const addressId = `bn-address-${tag}`;
  const agreements: string[] = [];
  const invoices: string[] = [];
  let n = 0;
  const next = (prefix: string) => `${prefix}_${tag}_${n++}`;
  const NOW = new Date();

  async function makeAgreement(extra: Record<string, unknown> = {}) {
    const id = next("bn-agreement");
    agreements.push(id);
    const subscription = next("sub");
    await prisma.rentalAgreement.create({ data: { id, customerId, serviceAddressId: addressId, status: "ACTIVE", stripeSubscriptionId: subscription, ...extra } });
    return { id, subscription };
  }
  function stripeBill(agreement: { subscription: string }, paid: boolean) {
    const id = next("in");
    const invoice = {
      id, status: paid ? "paid" : "open", amount_due: 4000, amount_paid: paid ? 4000 : 0, subtotal: 4000,
      parent: { subscription_details: { subscription: agreement.subscription } }, total_taxes: [],
      lines: { data: [{ description: "Washer", amount: 4000 }] },
      payments: { data: [{ payment: { payment_intent: `pi_paid_${id}` }, amount_paid: 4000, status: "paid" }], has_more: false },
    };
    m.invoices.set(id, invoice);
    return invoice;
  }
  async function localBill(agreement: { id: string }, stripeInvoiceId: string | null, dueDate: Date | null = null) {
    const id = next("bn-inv");
    invoices.push(id);
    await prisma.invoice.create({ data: { id, customerId, agreementId: agreement.id, status: "OPEN", subtotalCents: 4000, amountDueCents: 4000, stripeInvoiceId, dueDate } });
    return id;
  }
  async function openRow(args: { invoiceId?: string | null; agreementId?: string | null; stripeInvoiceId?: string | null; pi?: string; startedAt?: Date; lastCheckedAt?: Date | null; settledInStripeAt?: Date | null }) {
    return prisma.bankPaymentInFlight.create({
      data: {
        invoiceId: args.invoiceId ?? null, agreementId: args.agreementId ?? null, stripeInvoiceId: args.stripeInvoiceId ?? null,
        source: "STRIPE_INVOICE", paymentIntentId: args.pi ?? next("pi"), amountCents: 4000, method: "ach",
        startedAt: args.startedAt ?? new Date(NOW.getTime() - 3_600_000), lastCheckedAt: args.lastCheckedAt ?? null, settledInStripeAt: args.settledInStripeAt ?? null,
      },
    });
  }
  const row = (id: string) => prisma.bankPaymentInFlight.findUniqueOrThrow({ where: { id } });
  /** Close every other open row so each test's counts only describe its own rows. */
  async function closeAllOpenRows() {
    await prisma.bankPaymentInFlight.updateMany({ where: { clearedAt: null }, data: { clearedAt: new Date(), clearedReason: "CANCELED" } });
  }

  beforeEach(() => {
    m.intents.clear();
    m.sessions.clear();
    m.slowDays = 6;
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Nightly fixture", role: "CUSTOMER" } });
    await prisma.user.create({ data: { id: adminId, email: `a${tag}@example.test`, name: "Admin fixture", role: "ADMIN" } });
    await prisma.user.create({ data: { id: demotedId, email: `d${tag}@example.test`, name: "Demoted fixture", role: "STAFF" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `N${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "100 Test St", city: "Denver", zip: "80201" } });
  });

  afterAll(async () => {
    const all = await prisma.invoice.findMany({ where: { customerId }, select: { id: true } });
    const ids = all.map((r) => r.id);
    await prisma.bankPaymentInFlight.deleteMany({ where: { OR: [{ invoiceId: { in: ids } }, { agreementId: { in: agreements } }] } });
    await prisma.refund.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.pendingCharge.deleteMany({ where: { customerId } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.deposit.deleteMany({ where: { agreementId: { in: agreements } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...ids, ...agreements] } }, { userId: { in: [adminId, demotedId] } }] } });
    await prisma.webhookEvent.deleteMany({ where: { id: { startsWith: "evt_bankrecover_in_" + tag } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreements } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId, demotedId] } } });
  });

  it("a missed invoice.paid is found overnight and recorded once; running it again changes nothing", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const bill = stripeBill(agreement, true);
    const billId = await localBill(agreement, bill.id);
    const pi = `pi_paid_${bill.id}`;
    m.intents.set(pi, { status: "succeeded" });
    const r = await openRow({ invoiceId: billId, stripeInvoiceId: bill.id, pi });

    const first = await checkBankPaymentsInFlight(NOW);
    expect(first).toMatchObject({ checked: 1, recovered: 1, errors: 0, needsCheck: 0 });
    expect((await row(r.id)).clearedReason).toBe("SUCCEEDED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: billId } })).status).toBe("PAID");
    expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(1);

    const second = await checkBankPaymentsInFlight(NOW);
    expect(second.checked).toBe(0);
    expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(1);
  });

  it("failed and canceled payments are cleared; a payment still processing stays and is marked as checked", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const mk = async (status: string) => {
      const bill = stripeBill(agreement, false);
      const billId = await localBill(agreement, bill.id);
      const pi = next("pi");
      m.intents.set(pi, { status });
      return openRow({ invoiceId: billId, stripeInvoiceId: bill.id, pi });
    };
    const failed = await mk("requires_payment_method");
    const canceled = await mk("canceled");
    const processing = await mk("processing");
    const counts = await checkBankPaymentsInFlight(NOW);
    expect(counts).toMatchObject({ checked: 3, cleared: 2, stillProcessing: 1, errors: 0 });
    expect(await row(failed.id)).toMatchObject({ clearedReason: "FAILED" });
    expect(await row(canceled.id)).toMatchObject({ clearedReason: "CANCELED" });
    const still = await row(processing.id);
    expect(still.clearedAt).toBeNull();
    expect(still.lastCheckedAt).not.toBeNull();
  });

  it("one payment Stripe cannot answer about is skipped and counted; the others still finish", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const a = await openRow({ agreementId: agreement.id, pi: next("pi") });
    const b = await openRow({ agreementId: agreement.id, pi: next("pi") });
    m.intents.set(a.paymentIntentId, "error");
    m.intents.set(b.paymentIntentId, { status: "canceled" });
    const counts = await checkBankPaymentsInFlight(NOW);
    expect(counts).toMatchObject({ checked: 1, errors: 1, cleared: 1 });
    expect((await row(a.id)).clearedAt).toBeNull();
    expect((await row(a.id)).lastCheckedAt).not.toBeNull(); // a failed look still counts as a look
    expect((await row(b.id)).clearedReason).toBe("CANCELED");
  });

  it("when Stripe says paid but recording throws, the row is still marked cleared-in-Stripe for To do", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const bill = stripeBill(agreement, true);
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "succeeded" });
    m.invoices.delete(bill.id); // the invoice lookup now fails inside recovery
    const r = await openRow({ invoiceId: billId, stripeInvoiceId: bill.id, pi });
    const counts = await checkBankPaymentsInFlight(NOW);
    expect(counts).toMatchObject({ errors: 1, needsCheck: 1 });
    const after = await row(r.id);
    expect(after.clearedAt).toBeNull();
    expect(after.settledInStripeAt).not.toBeNull();
    expect((await listBankPaymentSlow(10, new Date())).rows[0]).toMatchObject({ severity: "high" });
  });

  it("looks at 50 a night, never-checked first, and reaches all 120 in three nights", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    await prisma.bankPaymentInFlight.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        agreementId: agreement.id, source: "STRIPE_INVOICE" as const, paymentIntentId: `pi_rot_${tag}_${i}`, amountCents: 4000, method: "ach",
        startedAt: new Date(NOW.getTime() - 3_600_000 - i),
      })),
    });
    const seen = async () => prisma.bankPaymentInFlight.count({ where: { agreementId: agreement.id, lastCheckedAt: { not: null } } });
    expect((await checkBankPaymentsInFlight(new Date(NOW.getTime() + 1000))).checked).toBe(50);
    expect(await seen()).toBe(50);
    expect((await checkBankPaymentsInFlight(new Date(NOW.getTime() + 2000))).checked).toBe(50);
    expect(await seen()).toBe(100);
    expect((await checkBankPaymentsInFlight(new Date(NOW.getTime() + 3000))).checked).toBe(50);
    expect(await seen()).toBe(120); // the third night took the last 20 never-checked rows first
    await closeAllOpenRows();
  });

  it("a retry that started after we asked Stripe is not cleared by the older answer", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const r = await openRow({ agreementId: agreement.id, startedAt: new Date(Date.now() + 120_000) });
    m.intents.set(r.paymentIntentId, { status: "requires_payment_method" });
    const counts = await checkBankPaymentsInFlight(NOW);
    expect(counts).toMatchObject({ cleared: 0, changedDuringCheck: 1 });
    expect((await row(r.id)).clearedAt).toBeNull();
  });

  it("Stripe says paid but the invoice is not paid yet: nothing is recorded, the row stays and is remembered for To do", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const bill = stripeBill(agreement, false); // Stripe's invoice is still open
    const billId = await localBill(agreement, bill.id);
    const pi = next("pi");
    m.intents.set(pi, { status: "succeeded" });
    const r = await openRow({ invoiceId: billId, stripeInvoiceId: bill.id, pi });
    const counts = await checkBankPaymentsInFlight(NOW);
    expect(counts).toMatchObject({ recovered: 0, needsCheck: 1 });
    const after = await row(r.id);
    expect(after.clearedAt).toBeNull();
    expect(after.settledInStripeAt).not.toBeNull();
    expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: billId } })).status).toBe("OPEN");
  });

  it("a row with no local bill yet is recorded through the normal payment handlers", async () => {
    await closeAllOpenRows();
    const agreement = await makeAgreement();
    const bill = stripeBill(agreement, true);
    const pi = `pi_paid_${bill.id}`;
    m.intents.set(pi, { status: "succeeded" });
    const r = await openRow({ agreementId: agreement.id, stripeInvoiceId: bill.id, pi });
    expect((await checkBankPaymentsInFlight(NOW)).recovered).toBe(1);
    expect((await row(r.id)).clearedReason).toBe("SUCCEEDED");
    const bills = await prisma.invoice.findMany({ where: { stripeInvoiceId: bill.id } });
    expect(bills).toHaveLength(1);
    invoices.push(bills[0]!.id);
    expect(bills[0]!.status).toBe("PAID");
  });

  describe("Record it now", () => {
    async function settledRow() {
      const agreement = await makeAgreement();
      const bill = stripeBill(agreement, true);
      const billId = await localBill(agreement, bill.id);
      const pi = `pi_paid_${bill.id}`;
      m.intents.set(pi, { status: "succeeded" });
      const r = await openRow({ invoiceId: billId, stripeInvoiceId: bill.id, pi, settledInStripeAt: new Date() });
      return { r, billId };
    }

    it("records the payment once; pressing it again changes nothing", async () => {
      const { r, billId } = await settledRow();
      expect(await recoverBankSettlement(r.id, adminId)).toBe("recorded");
      expect(await recoverBankSettlement(r.id, adminId)).toBe("already_recorded");
      expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(1);
      expect((await row(r.id)).clearedReason).toBe("SUCCEEDED");
      const audits = await prisma.auditLog.count({ where: { action: "billing.bank_payment_recovered", entityId: r.id } });
      expect(audits).toBe(1);
    });

    it("two presses at the same moment still record it once", async () => {
      const { r, billId } = await settledRow();
      const results = await Promise.all([recoverBankSettlement(r.id, adminId), recoverBankSettlement(r.id, adminId)]);
      expect(results.every((x) => x === "recorded" || x === "already_recorded")).toBe(true);
      expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "billing.bank_payment_recovered", entityId: r.id } })).toBe(1);
    });

    it("a webhook that arrives during recovery cannot double-record it", async () => {
      const { r, billId } = await settledRow();
      const { processStripeWebhookEvent } = await import("@/domains/billing/webhooks");
      const bill = m.invoices.get((await row(r.id)).stripeInvoiceId!) as Stripe.Invoice;
      const hook = { id: `evt_${randomUUID()}`, type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: bill } } as unknown as Stripe.Event;
      await Promise.all([processStripeWebhookEvent(hook), recoverBankSettlement(r.id, adminId)]);
      expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(1);
      expect((await row(r.id)).clearedAt).not.toBeNull();
      await prisma.webhookEvent.deleteMany({ where: { id: hook.id } });
    });

    it("Stripe not showing it paid records nothing", async () => {
      const agreement = await makeAgreement();
      const bill = stripeBill(agreement, false);
      const billId = await localBill(agreement, bill.id);
      const r = await openRow({ invoiceId: billId, stripeInvoiceId: bill.id, settledInStripeAt: new Date() });
      expect(await recoverBankSettlement(r.id, adminId)).toBe("not_paid");
      expect((await row(r.id)).clearedAt).toBeNull();
      expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(0);
    });

    it("someone who is no longer an owner or admin is refused and nothing is recorded", async () => {
      const { r, billId } = await settledRow();
      await expect(recoverBankSettlement(r.id, demotedId)).rejects.toThrow(/no longer has access/);
      await prisma.user.update({ where: { id: adminId }, data: { archivedAt: new Date() } });
      await expect(recoverBankSettlement(r.id, adminId)).rejects.toThrow(/no longer has access/);
      await prisma.user.update({ where: { id: adminId }, data: { archivedAt: null } });
      expect(await prisma.payment.count({ where: { invoiceId: billId } })).toBe(0);
      expect((await row(r.id)).clearedAt).toBeNull();
    });

    it("a local checkout payment is recorded from the paid checkout session", async () => {
      const id = next("bn-inv");
      invoices.push(id);
      await prisma.invoice.create({ data: { id, customerId, status: "OPEN", subtotalCents: 4000, amountDueCents: 4000, saleKind: "SHOP_SALE", saleLocation: "PICKUP" } });
      const pi = next("pi");
      const session = {
        id: next("cs"), object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: pi, amount_total: 4000, currency: "usd",
        metadata: { localInvoiceId: id }, client_reference_id: id,
      };
      m.sessions.set(pi, session);
      const r = await prisma.bankPaymentInFlight.create({
        data: { invoiceId: id, source: "LOCAL_CHECKOUT", paymentIntentId: pi, amountCents: 4000, method: "ach", startedAt: new Date(Date.now() - 3_600_000), settledInStripeAt: new Date() },
      });
      expect(await recoverBankSettlement(r.id, adminId)).toBe("recorded");
      expect((await row(r.id)).clearedReason).toBe("SUCCEEDED");
      expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(1);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
    });
  });

  describe("late fees wait for the bank", () => {
    // A bill 15 days overdue whose customer was told 5 days ago: a fee would be due today, unless the bank is confirming.
    async function warnedLateBill() {
      const agreement = await makeAgreement({ lateFeeGraceDays: 10, lateFeeCents: 500, lateFeePercent: 0 });
      const billId = await localBill(agreement, null, new Date(Date.now() - 15 * 86_400_000));
      await prisma.invoice.update({ where: { id: billId }, data: { lateFeeToldOn: new Date(Date.now() - 5 * 86_400_000) } });
      return { agreement, billId };
    }
    const fees = (billId: string) => prisma.pendingCharge.count({ where: { forInvoiceId: billId } });

    it("no fee while a bank payment is open; the fee is recorded once it is cleared", async () => {
      const { agreement, billId } = await warnedLateBill();
      const r = await openRow({ invoiceId: billId, agreementId: agreement.id });
      await runLateFees();
      expect(await fees(billId)).toBe(0);
      await prisma.bankPaymentInFlight.update({ where: { id: r.id }, data: { clearedAt: new Date(), clearedReason: "SUCCEEDED" } });
      await runLateFees();
      expect(await fees(billId)).toBe(1);
      // and the overdue bill itself never changed
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: billId } })).amountDueCents).toBe(4000);
    });

    it("a fee run and a bank payment opening at the same moment can never both win", async () => {
      const { agreement, billId } = await warnedLateBill();
      const opener = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${billId} FOR UPDATE`; // the lock the webhook takes first
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.bankPaymentInFlight.create({
          data: { invoiceId: billId, agreementId: agreement.id, source: "STRIPE_INVOICE", paymentIntentId: next("pi"), amountCents: 4000, method: "ach", startedAt: new Date() },
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await Promise.all([opener, runLateFees()]);
      // The fee run had to wait for the bill lock, then saw the open row.
      expect(await fees(billId)).toBe(0);
    });
  });

  describe("To do", () => {
    const old = () => new Date(Date.now() - 20 * 86_400_000);

    it("a bill being confirmed is not chased as past due; a normal late bill still is", async () => {
      const agreement = await makeAgreement();
      const confirming = await localBill(agreement, null, new Date(Date.now() - 10 * 86_400_000));
      const plain = await localBill(agreement, null, new Date(Date.now() - 10 * 86_400_000));
      await openRow({ invoiceId: confirming, agreementId: agreement.id });
      const found = await prisma.invoice.findMany({ where: { AND: [pastDueTodoWhere(new Date()), { customerId }] }, select: { id: true } });
      const ids = found.map((x) => x.id);
      expect(ids).toContain(plain);
      expect(ids).not.toContain(confirming);
    });

    it("an old bank payment goes on To do after the owner's number of banking days, and changing 6 to 3 brings it sooner", async () => {
      await closeAllOpenRows();
      const agreement = await makeAgreement();
      const billId = await localBill(agreement, null);
      // Started Tuesday 13 Oct 2026, checked Friday 16 Oct: that is 3 banking days (Wed, Thu, Fri).
      const startedAt = new Date("2026-10-13T12:00:00Z");
      const friday = new Date("2026-10-16T18:00:00Z");
      await openRow({ invoiceId: billId, agreementId: agreement.id, startedAt });
      m.slowDays = 6;
      expect((await listBankPaymentSlow(10, friday)).total).toBe(0);
      m.slowDays = 3;
      const sooner = await listBankPaymentSlow(10, friday);
      expect(sooner.total).toBe(1);
      expect(sooner.rows[0]).toMatchObject({ category: "BANK_PAYMENT_SLOW", severity: "medium" });
      expect(sooner.rows[0]!.title).toContain("Nightly fixture");
    });

    it("a payment Stripe says cleared shows at once, as high priority with Record it now", async () => {
      await closeAllOpenRows();
      const agreement = await makeAgreement();
      const billId = await localBill(agreement, null);
      const r = await openRow({ invoiceId: billId, agreementId: agreement.id, startedAt: new Date(Date.now() - 3_600_000), settledInStripeAt: new Date() });
      const list = await listBankPaymentSlow(10, new Date());
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]).toMatchObject({ severity: "high", action: { type: "RECORD_BANK_PAYMENT", id: r.id } });
      void old;
    });

    it("another customer's payment never shows in this customer's list", async () => {
      await closeAllOpenRows();
      const agreement = await makeAgreement();
      await openRow({ agreementId: agreement.id, startedAt: old() });
      expect((await listBankPaymentSlow(10, new Date(), { customerId: customerId })).total).toBe(1);
      expect((await listBankPaymentSlow(10, new Date(), { customerId: "someone-else" })).total).toBe(0);
    });
  });
});
