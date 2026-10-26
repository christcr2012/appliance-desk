import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FEE-1 on real Postgres: warn first, fee only for warned customers, never during a payment, its own charge on the next bill.
// Messages and Stripe are fakes; the message fake writes the same MessageDelivery row the real sender would.
const m = vi.hoisted(() => ({ state: "ACCEPTED" as "ACCEPTED" | "NOT_SENT", keys: [] as string[], texts: [] as string[] }));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: async (input: {
    idempotencyKey: string; channel: "EMAIL" | "SMS"; purpose: "TRANSACTIONAL" | "MARKETING"; templateKey: string;
    recipient: { type: string; id?: string; address: string }; subject?: { type: string; id: string };
    render: () => { text: string };
  }) => {
    const { prisma } = await import("@/lib/prisma");
    m.keys.push(input.idempotencyKey);
    m.texts.push(input.render().text);
    const accepted = m.state === "ACCEPTED";
    const row = await prisma.messageDelivery.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: {
        idempotencyKey: input.idempotencyKey, channel: input.channel, purpose: input.purpose, templateKey: input.templateKey,
        recipientType: input.recipient.type, recipientId: input.recipient.id, recipientAddress: input.recipient.address,
        subjectType: input.subject?.type, subjectId: input.subject?.id, state: m.state, acceptedAt: accepted ? new Date() : null,
      },
      update: { state: m.state, acceptedAt: accepted ? new Date() : null },
    });
    return { state: row.state, deliveryId: row.id, providerMessageId: null };
  },
}));

import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  billPendingLateFees as billPendingLateFeesAll, lateFeeBillingEnabled, loadLateFeeFacts, recordToldByPhone, runLateFees as runLateFeesAll, sendLateNotice, waiveLateFee,
} from "@/domains/billing/late-fee-engine";
import { addDaysToKey } from "@/domains/billing/late-fee-rules";
import { inferLineItemKind } from "@/domains/billing/webhooks-base";
import { formatCents } from "@/domains/pricing";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe("inferLineItemKind (pure)", () => {
  it("a Stripe line that carries a late-fee charge id is a LATE_FEE line", () => {
    expect(inferLineItemKind("Late fee for bill #4", undefined, "pc_1")).toBe("LATE_FEE");
    expect(inferLineItemKind("Washer", undefined, undefined)).toBe("RENTAL");
  });
});

describe.skipIf(!enabled)("fair late fees (real Postgres, fake messages and Stripe)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 14);
  const ownerId = `lf-owner-${tag}`;
  const demotedId = `lf-demoted-${tag}`;
  const customers: string[] = [];
  // Every run is limited to this file's own customers: other test files share this database and run at the same time.
  const runLateFees = (at?: Date) => runLateFeesAll(at, { customerIds: customers });
  const billPendingLateFees = (at?: Date, client?: Parameters<typeof billPendingLateFeesAll>[1]) => billPendingLateFeesAll(at, client, { customerIds: customers });
  const agreements: string[] = [];
  const invoices: string[] = [];
  let n = 0;
  const next = (prefix: string) => `${prefix}-${tag}-${n++}`;
  const now = () => new Date();
  const todayKey = () => businessDateKey(now());
  const dueAgo = (days: number) => businessDateFromKey(addDaysToKey(todayKey(), -days))!;

  async function bill(opts: {
    dueDaysAgo: number; grace?: number; flat?: number; percent?: number; military?: boolean; subscription?: boolean;
    nextBillingInDays?: number | null; amountCents?: number; agreementStatus?: "ACTIVE" | "ENDED";
  }) {
    const userId = next("lf-user");
    const customerId = next("lf-customer");
    const addressId = next("lf-address");
    const agreementId = next("lf-agreement");
    const invoiceId = next("lf-invoice");
    customers.push(customerId);
    agreements.push(agreementId);
    invoices.push(invoiceId);
    await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: "Fee Customer", role: "CUSTOMER" } });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `F${tag.slice(0, 8)}${n}`, activeMilitary: opts.military ?? false, ...(opts.subscription ? { stripeCustomerId: next("cus") } : {}) },
    });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "9 Fee Lane", city: "Greeley", zip: "80631" } });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId, customerId, serviceAddressId: addressId, status: opts.agreementStatus ?? "ACTIVE",
        lateFeeGraceDays: opts.grace ?? 10, lateFeeCents: opts.flat ?? 500, lateFeePercent: opts.percent ?? 0,
        ...(opts.subscription ? { stripeSubscriptionId: next("sub") } : {}),
        ...(opts.nextBillingInDays != null ? { nextBillingDate: new Date(Date.now() + opts.nextBillingInDays * 86_400_000) } : {}),
      },
    });
    const amount = opts.amountCents ?? 4000;
    await prisma.invoice.create({
      data: { id: invoiceId, customerId, agreementId, status: "OPEN", subtotalCents: amount, amountDueCents: amount, amountPaidCents: 0, dueDate: dueAgo(opts.dueDaysAgo) },
    });
    return { customerId, agreementId, invoiceId, userId };
  }
  const inv = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id } });
  const charges = (invoiceId: string) => prisma.pendingCharge.findMany({ where: { forInvoiceId: invoiceId } });
  const toldDaysAgo = (invoiceId: string, days: number) =>
    prisma.invoice.update({ where: { id: invoiceId }, data: { lateFeeToldOn: new Date(Date.now() - days * 86_400_000), lateFeeToldByUserId: ownerId } });

  beforeEach(() => {
    m.state = "ACCEPTED";
    m.keys.length = 0;
    m.texts.length = 0;
    delete process.env.LATE_FEE_CUSTOMER_CHARGING_ENABLED;
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.test`, name: "Owner fixture", role: "OWNER" } });
    await prisma.user.create({ data: { id: demotedId, email: `${demotedId}@example.test`, name: "Demoted fixture", role: "STAFF" } });
  });

  afterAll(async () => {
    const ids = invoices;
    const chargeIds = (await prisma.pendingCharge.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((c) => c.id);
    await prisma.pendingCharge.deleteMany({ where: { customerId: { in: customers } } });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: chargeIds } } });
    await prisma.bankPaymentInFlight.deleteMany({ where: { invoiceId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: ids } } });
    const extra = (await prisma.invoice.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((r) => r.id);
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: extra } } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: customers } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...extra, ...chargeIds] } }, { userId: { in: [ownerId, demotedId] } }] } });
    await prisma.messageDelivery.deleteMany({ where: { subjectId: { in: extra } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: customers } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreements } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customers } } });
    const users = (await prisma.customer.findMany({ where: { id: { in: customers } }, select: { userId: true } })).map((c) => c.userId);
    await prisma.customer.deleteMany({ where: { id: { in: customers } } });
    await prisma.user.deleteMany({ where: { id: { in: [...users, ownerId, demotedId] } } });
  });

  describe("tell them first", () => {
    it("on the warning day the customer is told the date and amount; nothing is added to the bill", async () => {
      const b = await bill({ dueDaysAgo: 9 }); // fee day is day 11 = due + 11; warning goes out 2 days before
      await runLateFees();
      expect(m.keys).toContain(`late-notice-${b.invoiceId}-1`);
      const text = m.texts.at(-1) ?? "";
      expect(text).toContain(formatCents(4000));
      expect(text).toContain(formatCents(500));
      const after = await inv(b.invoiceId);
      expect(after.lateNoticeCount).toBe(1);
      expect(after.lateNoticeDeliveryId).toBeTruthy();
      expect(businessDateKey(after.lateFeeDate!)).toBe(addDaysToKey(todayKey(), 2));
      expect(after.amountDueCents).toBe(4000);
      expect(after.lateFeeCents).toBe(0);
      expect(await charges(b.invoiceId)).toHaveLength(0);
    });

    it("before the warning day nothing is sent", async () => {
      const b = await bill({ dueDaysAgo: 5 });
      await runLateFees();
      expect(m.keys.filter((k) => k.includes(b.invoiceId))).toHaveLength(0);
    });

    it("a warning that could not be sent is not a warning: no fee, and the bill goes to To do as not warned", async () => {
      const b = await bill({ dueDaysAgo: 9 });
      m.state = "NOT_SENT";
      await runLateFees();
      expect((await inv(b.invoiceId)).lateNoticeCount).toBe(0);
      // Two days on the fee day arrives; the customer was never warned.
      const later = new Date(Date.now() + 3 * 86_400_000);
      const out = await runLateFees(later);
      expect(await charges(b.invoiceId)).toHaveLength(0);
      expect(out.counts.needsWarning).toBeGreaterThan(0);
      const loaded = await loadLateFeeFacts(prisma, b.invoiceId, later);
      expect(loaded?.facts.warnedKey).toBeNull();
    });

    it("no warning on file, fee day long past: still no fee", async () => {
      const b = await bill({ dueDaysAgo: 20 });
      m.state = "NOT_SENT";
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
    });

    it("\"Send the warning\" after the fee day sets a new fee day two days out, then the fee follows", async () => {
      const b = await bill({ dueDaysAgo: 14 });
      const sent = await sendLateNotice(b.invoiceId, now(), ownerId);
      expect(sent.state).toBe("SENT");
      expect(sent.feeDateKey).toBe(addDaysToKey(todayKey(), 2));
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0); // not yet: the customer gets two days
      const later = new Date(Date.now() + 2 * 86_400_000 + 3_600_000);
      await runLateFees(later);
      expect(await charges(b.invoiceId)).toHaveLength(1);
    });

    it("Chris recording a phone call counts as the warning", async () => {
      const b = await bill({ dueDaysAgo: 14 });
      await recordToldByPhone(b.invoiceId, ownerId);
      const after = await inv(b.invoiceId);
      expect(after.lateFeeToldByUserId).toBe(ownerId);
      expect(businessDateKey(after.lateFeeDate!)).toBe(addDaysToKey(todayKey(), 2));
      await expect(recordToldByPhone(b.invoiceId, demotedId)).rejects.toThrow(/no longer has access/);
    });
  });

  describe("the fee itself", () => {
    it("a warned customer who has not paid by the fee day gets a pending charge; the late bill keeps its amount", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      const rows = await charges(b.invoiceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "LATE_FEE", amountCents: 500, customerId: b.customerId, appliedToInvoiceId: null, waivedAt: null });
      const after = await inv(b.invoiceId);
      expect(after.amountDueCents).toBe(4000);
      expect(after.lateFeeCents).toBe(0);
      expect(await prisma.invoiceLineItem.count({ where: { invoiceId: b.invoiceId, kind: "LATE_FEE" } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: "billing.late_fee_recorded", entityId: b.invoiceId } })).toBe(1);
    });

    it("once per bill: a second run and two overlapping runs add nothing more", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      await Promise.all([runLateFees(), runLateFees()]);
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(1);
    });

    it("day 11, not day 6: an agreement that says 5 days is lifted to 10; nothing on day 10", async () => {
      const early = await bill({ dueDaysAgo: 10, grace: 5 });
      await toldDaysAgo(early.invoiceId, 5);
      const ok = await bill({ dueDaysAgo: 11, grace: 5 });
      await toldDaysAgo(ok.invoiceId, 5);
      await runLateFees();
      expect(await charges(early.invoiceId)).toHaveLength(0);
      expect(await charges(ok.invoiceId)).toHaveLength(1);
    });

    it("never more than $15, whatever the agreement says", async () => {
      const b = await bill({ dueDaysAgo: 12, flat: 5000 });
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      expect((await charges(b.invoiceId))[0]?.amountCents).toBe(1500);
    });

    it("a bill that was paid before the fee day gets no fee", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      await prisma.invoice.update({ where: { id: b.invoiceId }, data: { status: "PAID", amountPaidCents: 4000 } });
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
    });

    it("a bill with no fee in the signed agreement gets none", async () => {
      const b = await bill({ dueDaysAgo: 12, flat: 0 });
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
    });

    it("an active-duty servicemember never gets an automatic fee", async () => {
      const b = await bill({ dueDaysAgo: 12, military: true });
      await toldDaysAgo(b.invoiceId, 5);
      const out = await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
      expect(out.counts.militaryReview).toBeGreaterThan(0);
    });

    it("more than 30 days after the due date nothing is assessed", async () => {
      const b = await bill({ dueDaysAgo: 35 });
      await toldDaysAgo(b.invoiceId, 25);
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
    });

    it("the stored fee day is a Denver calendar day", async () => {
      const b = await bill({ dueDaysAgo: 9 });
      await runLateFees();
      const key = businessDateKey((await inv(b.invoiceId)).lateFeeDate!);
      expect(key).toBe(addDaysToKey(todayKey(), 2));
    });
  });

  describe("never during a payment in progress", () => {
    it("an open bank payment holds the fee; once it fails the customer is warned again before any fee", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      const row = await prisma.bankPaymentInFlight.create({
        data: { invoiceId: b.invoiceId, agreementId: b.agreementId, source: "STRIPE_INVOICE", paymentIntentId: next("pi"), amountCents: 4000, method: "ach", startedAt: new Date(Date.now() - 3_600_000) },
      });
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);

      // The bank payment fails: a failed payment came after the warning, so a fresh warning goes out, not a fee.
      await prisma.bankPaymentInFlight.update({ where: { id: row.id }, data: { clearedAt: new Date(), clearedReason: "FAILED" } });
      await prisma.payment.create({ data: { invoiceId: b.invoiceId, amountCents: 4000, status: "failed", failureReason: "Bank said no" } });
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
      expect(m.keys).toContain(`late-notice-${b.invoiceId}-1`);
      expect(m.texts.at(-1)).toMatch(/did not go through/);
      const after = await inv(b.invoiceId);
      expect(businessDateKey(after.lateFeeDate!)).toBe(addDaysToKey(todayKey(), 2));
      // Two days later, still unpaid and the new warning was delivered: now the fee follows.
      await runLateFees(new Date(Date.now() + 2 * 86_400_000 + 3_600_000));
      expect(await charges(b.invoiceId)).toHaveLength(1);
    });

    it("a phone payment started a few hours ago holds the fee too", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      await prisma.auditLog.create({ data: { action: "billing.phone_payment_started", entityType: "Invoice", entityId: b.invoiceId, newValue: {} } });
      await runLateFees();
      expect(await charges(b.invoiceId)).toHaveLength(0);
      await runLateFees(new Date(Date.now() + 2 * 86_400_000)); // a day later it no longer counts
      expect(await charges(b.invoiceId)).toHaveLength(1);
    });
  });

  describe("putting the fee on the next bill", () => {
    async function recorded(opts: Parameters<typeof bill>[0]) {
      const b = await bill(opts);
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      const [charge] = await charges(b.invoiceId);
      expect(charge).toBeTruthy();
      return { ...b, chargeId: charge!.id };
    }
    function fakeStripe() {
      const calls: Array<{ params: Stripe.InvoiceItemCreateParams; key: string }> = [];
      const deleted: string[] = [];
      const behavior = { delFails: false, onInvoice: false };
      const client = {
        invoiceItems: {
          create: async (params: Stripe.InvoiceItemCreateParams, options: { idempotencyKey: string }) => { calls.push({ params, key: options.idempotencyKey }); return { id: `ii_${tag}_${calls.length}` }; },
          del: async (id: string) => {
            if (behavior.delFails) throw Object.assign(new Error("invoice item is on an invoice"), { type: "StripeInvalidRequestError" });
            deleted.push(id);
            return { id, deleted: true };
          },
          retrieve: async (id: string) => ({ id, invoice: behavior.onInvoice ? "in_made" : null }),
        },
      };
      return { calls, deleted, behavior, client: client as unknown as Stripe };
    }

    it("a rental with no card subscription gets a separate one-line bill, once, that is never charged automatically", async () => {
      const r = await recorded({ dueDaysAgo: 12 });
      const counts = await billPendingLateFees();
      expect(counts.billedLocal).toBeGreaterThanOrEqual(1);
      await billPendingLateFees();
      const charge = await prisma.pendingCharge.findUniqueOrThrow({ where: { id: r.chargeId } });
      expect(charge.appliedToInvoiceId).toBeTruthy();
      const feeBill = await prisma.invoice.findUniqueOrThrow({ where: { id: charge.appliedToInvoiceId! }, include: { lineItems: true } });
      expect(feeBill).toMatchObject({ status: "OPEN", amountDueCents: 500, stripeInvoiceId: null });
      expect(feeBill.lineItems).toHaveLength(1);
      expect(feeBill.lineItems[0]).toMatchObject({ kind: "LATE_FEE", amountCents: 500 });
      expect(feeBill.lineItems[0]!.description).toMatch(/^Late fee for bill #\d+/);
      expect(await prisma.invoice.count({ where: { customerId: r.customerId } })).toBe(2);
      // the overdue bill itself is untouched
      expect((await inv(r.invoiceId)).amountDueCents).toBe(4000);
    });

    it("a rental that ended gets the separate bill even when it had a subscription", async () => {
      const r = await recorded({ dueDaysAgo: 12, subscription: true, nextBillingInDays: 30, agreementStatus: "ENDED" });
      const { client, calls } = fakeStripe();
      await billPendingLateFees(now(), client);
      expect(calls).toHaveLength(0);
      expect((await prisma.pendingCharge.findUniqueOrThrow({ where: { id: r.chargeId } })).appliedToInvoiceId).toBeTruthy();
    });

    it("subscription: one Stripe invoice item for the upcoming bill, carrying the charge id; a retry never posts it twice", async () => {
      process.env.LATE_FEE_CUSTOMER_CHARGING_ENABLED = "true";
      expect(lateFeeBillingEnabled()).toBe(true);
      const r = await recorded({ dueDaysAgo: 12, subscription: true, nextBillingInDays: 20 });
      const { client, calls } = fakeStripe();
      const first = await billPendingLateFees(now(), client);
      expect(first.sentToStripe).toBeGreaterThanOrEqual(1);
      const mine = calls.filter((c) => (c.params.metadata as Record<string, string> | undefined)?.late_fee_pending_charge_id === r.chargeId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.params).toMatchObject({ amount: 500, currency: "usd", tax_rates: [] });
      expect(mine[0]!.params.description).toMatch(/^Late fee for bill #\d+/);
      expect(mine[0]!.key).toBe(`late-fee-${r.chargeId}`);
      await billPendingLateFees(now(), client);
      expect(calls.filter((c) => (c.params.metadata as Record<string, string> | undefined)?.late_fee_pending_charge_id === r.chargeId)).toHaveLength(1);
      const op = await prisma.providerOperation.findFirstOrThrow({ where: { subjectId: r.chargeId, kind: "LATE_FEE_INVOICE_ITEM" } });
      expect(op.status).toBe("SUCCEEDED");
    });

    it("autopay: the customer is told the amount and the date before anything is posted; no delivered notice, nothing posted", async () => {
      process.env.LATE_FEE_CUSTOMER_CHARGING_ENABLED = "true";
      const r = await recorded({ dueDaysAgo: 12, subscription: true, nextBillingInDays: 20 });
      const { client, calls } = fakeStripe();
      m.keys.length = 0;
      m.state = "NOT_SENT";
      const blocked = await billPendingLateFees(now(), client);
      expect(blocked.noticesNotSent).toBeGreaterThanOrEqual(1);
      expect(calls.filter((c) => (c.params.metadata as Record<string, string> | undefined)?.late_fee_pending_charge_id === r.chargeId)).toHaveLength(0);
      m.state = "ACCEPTED";
      await billPendingLateFees(now(), client);
      const charge = await prisma.pendingCharge.findUniqueOrThrow({ where: { id: r.chargeId } });
      expect(charge.autopayNoticedAt).toBeTruthy();
      expect(charge.autopayChargeOn).toBeTruthy();
      expect(m.keys.some((k) => k.startsWith(`late-fee-autopay-${r.chargeId}-`))).toBe(true);
      expect(calls.filter((c) => (c.params.metadata as Record<string, string> | undefined)?.late_fee_pending_charge_id === r.chargeId)).toHaveLength(1);
      expect(m.texts.some((text) => text.includes(formatCents(500)) && text.includes("automatic payment"))).toBe(true);
    });

    it("a bill that is only a late fee never earns another late fee", async () => {
      const r = await recorded({ dueDaysAgo: 12 });
      await billPendingLateFees(); // makes the separate one-line fee bill
      const feeBillId = (await prisma.pendingCharge.findUniqueOrThrow({ where: { id: r.chargeId } })).appliedToInvoiceId!;
      await prisma.invoice.update({ where: { id: feeBillId }, data: { dueDate: dueAgo(20) } });
      await runLateFees();
      await runLateFees(new Date(Date.now() + 5 * 86_400_000));
      expect(await prisma.pendingCharge.count({ where: { forInvoiceId: feeBillId } })).toBe(0);
      expect(await prisma.invoice.count({ where: { customerId: r.customerId } })).toBe(2);
    });

    it("autopay: when the next automatic charge is less than 10 days away the fee waits for the one after", async () => {
      process.env.LATE_FEE_CUSTOMER_CHARGING_ENABLED = "true";
      const r = await recorded({ dueDaysAgo: 12, subscription: true, nextBillingInDays: 5 });
      const { client, calls } = fakeStripe();
      const out = await billPendingLateFees(now(), client);
      expect(out.waitingForNextBill).toBeGreaterThanOrEqual(1);
      expect(calls.filter((c) => (c.params.metadata as Record<string, string> | undefined)?.late_fee_pending_charge_id === r.chargeId)).toHaveLength(0);
      expect((await prisma.pendingCharge.findUniqueOrThrow({ where: { id: r.chargeId } })).appliedToInvoiceId).toBeNull();
    });

    it("customer charging off (no test key, no owner switch): nothing goes to Stripe", async () => {
      const key = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = "not-a-test-key";
      try {
        const r = await recorded({ dueDaysAgo: 12, subscription: true, nextBillingInDays: 20 });
        const { client, calls } = fakeStripe();
        const out = await billPendingLateFees(now(), client);
        expect(out.stripeBillingOff).toBeGreaterThanOrEqual(1);
        expect(calls.filter((c) => (c.params.metadata as Record<string, string> | undefined)?.late_fee_pending_charge_id === r.chargeId)).toHaveLength(0);
      } finally {
        if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
        else process.env.STRIPE_SECRET_KEY = key;
      }
    });
  });

  describe("waiving", () => {
    it("before it is billed: never billed, reason and person kept", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      const [charge] = await charges(b.invoiceId);
      await expect(waiveLateFee(charge!.id, ownerId, " ")).rejects.toThrow(/reason/);
      await expect(waiveLateFee(charge!.id, demotedId, "Kind customer")).rejects.toThrow(/no longer has access/);
      expect(await waiveLateFee(charge!.id, ownerId, "Paid by phone, was in the hospital")).toBe("waived");
      expect(await waiveLateFee(charge!.id, ownerId, "again")).toBe("already");
      const after = await prisma.pendingCharge.findUniqueOrThrow({ where: { id: charge!.id } });
      expect(after).toMatchObject({ waivedReason: "Paid by phone, was in the hospital", waivedByUserId: ownerId });
      expect(after.waivedAt).toBeTruthy();
      await billPendingLateFees();
      expect((await prisma.pendingCharge.findUniqueOrThrow({ where: { id: charge!.id } })).appliedToInvoiceId).toBeNull();
      expect(await prisma.invoice.count({ where: { customerId: b.customerId } })).toBe(1);
    });

    it("after it is billed: the customer gets the same amount back as a credit", async () => {
      const b = await bill({ dueDaysAgo: 12 });
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      await billPendingLateFees();
      const [charge] = await charges(b.invoiceId);
      expect(charge!.appliedToInvoiceId).toBeTruthy();
      expect(await waiveLateFee(charge!.id, ownerId, "Goodwill")).toBe("credited");
      const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId: b.customerId, sourceId: charge!.id } });
      expect(credit).toMatchObject({ amountCents: 500, remainingCents: 500 });
    });
  });

  describe("waiving a fee already sent to Stripe", () => {
    async function sentToStripe() {
      process.env.LATE_FEE_CUSTOMER_CHARGING_ENABLED = "true";
      const b = await bill({ dueDaysAgo: 12, subscription: true, nextBillingInDays: 20 });
      await toldDaysAgo(b.invoiceId, 5);
      await runLateFees();
      const stripe = (() => {
        const calls: string[] = [];
        const deleted: string[] = [];
        const behavior = { delFails: false, onInvoice: false };
        const client = {
          invoiceItems: {
            create: async () => { calls.push("create"); return { id: `ii_w_${tag}_${n++}` }; },
            del: async (id: string) => { if (behavior.delFails) throw Object.assign(new Error("on an invoice"), { type: "StripeInvalidRequestError" }); deleted.push(id); return { id, deleted: true }; },
            retrieve: async (id: string) => ({ id, invoice: behavior.onInvoice ? "in_made" : null }),
          },
        };
        return { calls, deleted, behavior, client: client as unknown as Stripe };
      })();
      await billPendingLateFees(now(), stripe.client);
      const [charge] = await charges(b.invoiceId);
      return { b, charge: charge!, stripe };
    }

    it("the Stripe item is deleted first, so Stripe never collects a waived fee", async () => {
      const { b, charge, stripe } = await sentToStripe();
      expect(charge.appliedToInvoiceId).toBeNull();
      expect(await waiveLateFee(charge.id, ownerId, "Customer called", now(), stripe.client)).toBe("waived");
      expect(stripe.deleted).toHaveLength(1);
      expect(await prisma.customerCredit.count({ where: { customerId: b.customerId, sourceId: charge.id } })).toBe(0);
    });

    it("if Stripe already put the item on a bill, the customer gets a credit instead", async () => {
      const { b, charge, stripe } = await sentToStripe();
      stripe.behavior.delFails = true;
      stripe.behavior.onInvoice = true;
      expect(await waiveLateFee(charge.id, ownerId, "Goodwill", now(), stripe.client)).toBe("credited");
      expect(await prisma.customerCredit.count({ where: { customerId: b.customerId, sourceId: charge.id } })).toBe(1);
    });

    it("if Stripe cannot be reached, nothing is waived and the owner is told to try again", async () => {
      const { charge, stripe } = await sentToStripe();
      stripe.behavior.delFails = true;
      await expect(waiveLateFee(charge.id, ownerId, "Goodwill", now(), stripe.client)).rejects.toThrow(/Stripe could not remove/);
      expect((await prisma.pendingCharge.findUniqueOrThrow({ where: { id: charge.id } })).waivedAt).toBeNull();
    });

    it("while the send to Stripe is still in progress the waiver waits", async () => {
      const { charge, stripe } = await sentToStripe();
      await prisma.providerOperation.updateMany({ where: { subjectId: charge.id, kind: "LATE_FEE_INVOICE_ITEM" }, data: { status: "PENDING" } });
      await expect(waiveLateFee(charge.id, ownerId, "Goodwill", now(), stripe.client)).rejects.toThrow(/being sent to Stripe/);
    });
  });

  describe("other customers", () => {
    it("a fee for one customer never touches another customer's bill", async () => {
      const a = await bill({ dueDaysAgo: 12 });
      const other = await bill({ dueDaysAgo: 2 });
      await toldDaysAgo(a.invoiceId, 5);
      await runLateFees();
      await billPendingLateFees();
      expect(await charges(other.invoiceId)).toHaveLength(0);
      expect(await prisma.invoice.count({ where: { customerId: other.customerId } })).toBe(1);
      expect(await prisma.pendingCharge.count({ where: { customerId: other.customerId } })).toBe(0);
    });
  });
});
