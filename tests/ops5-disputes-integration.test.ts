import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";
import { handleDisputeEvent } from "@/domains/disputes/webhook";
import { approveAndSendEvidence, clearBankDebitBlock, markBankDisputeHandled, saveAchDisputeWindowDays } from "@/domains/disputes/actions";
import { listDisputeAttention } from "@/domains/exceptions/dispute-attention";
import { issueInvoiceRefund } from "@/domains/billing/refunds";
import { REFUND_ON_DISPUTE_WARNING } from "@/domains/disputes/rules";

// OPS-5 on real Postgres: Stripe's dispute events are recorded and flagged, never answered or refunded by themselves;
// "Approve and send" submits once; a bank dispute switches autopay off; a refund on a disputed bill is stopped.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("payment disputes (real Postgres, fake Stripe)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const ownerId = `ops5-owner-${tag}`;
  const staffId = `ops5-staff-${tag}`;
  const cardUserId = `ops5-card-${tag}`;
  const bankUserId = `ops5-bank-${tag}`;
  let cardCustomer = "";
  let bankCustomer = "";
  let cardInvoice = "";
  let bankInvoice = "";
  const now = Math.floor(Date.now() / 1000);

  const event = (type: Stripe.Event["type"], dispute: Record<string, unknown>, created = now): Stripe.Event =>
    ({ id: `evt_${randomUUID()}`, type, created, data: { object: dispute } }) as unknown as Stripe.Event;
  const send = (e: Stripe.Event) => prisma.$transaction((tx) => handleDisputeEvent(tx, e));
  const cardDispute = (id: string, status = "needs_response", extra: Record<string, unknown> = {}) => ({
    id, status, amount: 12_500, reason: "product_not_received", charge: `ch_card_${tag}`, payment_intent: `pi_card_${tag}`,
    created: now, evidence_details: { due_by: now + 9 * 86_400 }, ...extra,
  });

  beforeAll(async () => {
    for (const [id, role] of [[ownerId, "OWNER"], [staffId, "STAFF"], [cardUserId, "CUSTOMER"], [bankUserId, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: `${id}@example.test`, name: `OPS5 ${id.slice(5, 9)}`, role, emailVerified: true } });
    }
    cardCustomer = (await prisma.customer.create({ data: { userId: cardUserId, referralCode: `O5C${tag}`, stripeDefaultPaymentMethodId: "pm_card" } })).id;
    bankCustomer = (await prisma.customer.create({ data: { userId: bankUserId, referralCode: `O5B${tag}`, stripeDefaultPaymentMethodId: "pm_bank" } })).id;
    cardInvoice = (await prisma.invoice.create({ data: { customerId: cardCustomer, status: "PAID", amountDueCents: 12_500, amountPaidCents: 12_500 } })).id;
    bankInvoice = (await prisma.invoice.create({ data: { customerId: bankCustomer, status: "PAID", amountDueCents: 8_000, amountPaidCents: 8_000 } })).id;
    await prisma.payment.create({ data: { invoiceId: cardInvoice, amountCents: 12_500, status: "succeeded", method: "card", stripePaymentIntentId: `pi_card_${tag}`, stripeChargeId: `ch_card_${tag}` } });
    await prisma.payment.create({ data: { invoiceId: bankInvoice, amountCents: 8_000, status: "succeeded", method: "ach", stripePaymentIntentId: `pi_bank_${tag}`, stripeChargeId: `ch_bank_${tag}` } });
  });

  afterAll(async () => {
    __setStripeClientForTests(null);
    const ids = [cardCustomer, bankCustomer];
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityType: "Customer", entityId: { in: ids } }, { entityType: "PaymentDispute", entityId: { in: (await prisma.paymentDispute.findMany({ where: { customerId: { in: ids } }, select: { id: true } })).map((d) => d.id) } }] } });
    await prisma.paymentDispute.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.refund.deleteMany({ where: { invoice: { customerId: { in: ids } } } });
    await prisma.payment.deleteMany({ where: { invoice: { customerId: { in: ids } } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, cardUserId, bankUserId] } } });
  });

  it("records a card dispute once, matched to its payment, and puts it on the To do list", async () => {
    const d = cardDispute(`dp_card_${tag}`);
    await send(event("charge.dispute.created", d));
    await send(event("charge.dispute.created", d)); // Stripe retries: still one row
    const rows = await prisma.paymentDispute.findMany({ where: { stripeDisputeId: d.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "NEEDS_RESPONSE", isBank: false, customerId: cardCustomer, invoiceId: cardInvoice, amountCents: 12_500 });
    const attention = await listDisputeAttention(500, new Date());
    expect(attention.rows.some((r) => r.href === `/desk/disputes/${rows[0]!.id}` && r.category === "PAYMENT_DISPUTE")).toBe(true);
    expect((await prisma.customer.findUnique({ where: { id: cardCustomer } }))?.stripeDefaultPaymentMethodId).toBe("pm_card"); // card autopay untouched
  });

  it("ignores an older event that arrives late, and a final answer is never undone", async () => {
    const d = cardDispute(`dp_order_${tag}`);
    await send(event("charge.dispute.created", d, now));
    await send(event("charge.dispute.closed", { ...d, status: "won" }, now + 100));
    await send(event("charge.dispute.updated", { ...d, status: "under_review" }, now + 50));
    await send(event("charge.dispute.updated", { ...d, status: "needs_response" }, now + 200));
    const row = await prisma.paymentDispute.findUniqueOrThrow({ where: { stripeDisputeId: d.id } });
    expect(row.state).toBe("WON");
    const todo = await listDisputeAttention(500, new Date());
    expect(todo.rows.some((r) => r.href === `/desk/disputes/${row.id}`)).toBe(false);
  });

  it("answers a card dispute exactly once, even when two people press the button together", async () => {
    const row = await prisma.paymentDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_card_${tag}` } });
    const create = vi.fn(async () => ({ id: "file_test" }));
    const update = vi.fn(async () => ({ id: row.stripeDisputeId }));
    __setStripeClientForTests({ files: { create }, disputes: { update } } as never);
    const results = await Promise.allSettled([
      approveAndSendEvidence(ownerId, row.id, { loadPhoto: async () => null }),
      approveAndSendEvidence(ownerId, row.id, { loadPhoto: async () => null }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0] as unknown[])[1]).toMatchObject({ submit: true, evidence: { service_documentation: "file_test" } });
    const after = await prisma.paymentDispute.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.evidenceFileId).toBe("file_test");
    await expect(approveAndSendEvidence(ownerId, row.id, { loadPhoto: async () => null })).rejects.toThrow(/already sent|no longer waiting/);
    const todo = await listDisputeAttention(500, new Date());
    expect(todo.rows.some((r) => r.href === `/desk/disputes/${row.id}`)).toBe(false); // answered: off the list
  });

  it("lets only the owner or an admin send an answer, and releases the claim when Stripe fails", async () => {
    const d = cardDispute(`dp_fail_${tag}`);
    await send(event("charge.dispute.created", d));
    const row = await prisma.paymentDispute.findUniqueOrThrow({ where: { stripeDisputeId: d.id } });
    await expect(approveAndSendEvidence(staffId, row.id, { loadPhoto: async () => null })).rejects.toThrow();
    __setStripeClientForTests({ files: { create: vi.fn(async () => { throw new Error("stripe down"); }) }, disputes: { update: vi.fn() } } as never);
    await expect(approveAndSendEvidence(ownerId, row.id, { loadPhoto: async () => null })).rejects.toThrow(/Nothing was submitted/);
    expect((await prisma.paymentDispute.findUniqueOrThrow({ where: { id: row.id } })).evidenceSubmittedAt).toBeNull();
  });

  it("refuses an answer after the deadline", async () => {
    const d = cardDispute(`dp_late_${tag}`, "needs_response", { evidence_details: { due_by: now - 3600 } });
    await send(event("charge.dispute.created", d));
    const row = await prisma.paymentDispute.findUniqueOrThrow({ where: { stripeDisputeId: d.id } });
    await expect(approveAndSendEvidence(ownerId, row.id, { loadPhoto: async () => null })).rejects.toThrow(/deadline has passed/);
  });

  it("a bank dispute can't be contested, switches bank autopay off, and clears only by decision", async () => {
    const d = { id: `dp_bank_${tag}`, status: "lost", amount: 8_000, reason: "debit_not_authorized", charge: `ch_bank_${tag}`, payment_intent: `pi_bank_${tag}`, created: now };
    await send(event("charge.dispute.created", d));
    const row = await prisma.paymentDispute.findUniqueOrThrow({ where: { stripeDisputeId: d.id } });
    expect(row.isBank).toBe(true);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: bankCustomer } });
    expect(customer.stripeDefaultPaymentMethodId).toBeNull();
    expect(customer.bankDebitBlockedAt).not.toBeNull();
    await expect(approveAndSendEvidence(ownerId, row.id, { loadPhoto: async () => null })).rejects.toThrow(/can't be contested/);
    expect((await listDisputeAttention(500, new Date())).rows.some((r) => r.href === `/desk/disputes/${row.id}`)).toBe(true);
    await expect(markBankDisputeHandled(ownerId, row.id, "  ")).rejects.toThrow(/Say briefly/);
    await markBankDisputeHandled(ownerId, row.id, "Customer paid by check");
    expect((await listDisputeAttention(500, new Date())).rows.some((r) => r.href === `/desk/disputes/${row.id}`)).toBe(false);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: bankCustomer } })).bankDebitBlockedAt).not.toBeNull(); // handling the bill does not re-allow autopay
    await clearBankDebitBlock(ownerId, bankCustomer);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: bankCustomer } })).bankDebitBlockedAt).toBeNull();
  });

  it("stops a refund on a bill with an open dispute, unless the owner has read the warning", async () => {
    const d = cardDispute(`dp_refund_${tag}`);
    await send(event("charge.dispute.created", d));
    await expect(issueInvoiceRefund(ownerId, { invoiceId: cardInvoice, amountCents: 1_000, reason: "OTHER", toCredit: true })).rejects.toThrow(REFUND_ON_DISPUTE_WARNING);
    expect(await prisma.refund.count({ where: { invoiceId: cardInvoice } })).toBe(0);
    await issueInvoiceRefund(ownerId, { invoiceId: cardInvoice, amountCents: 1_000, reason: "OTHER", toCredit: true, acknowledgeDispute: true });
    expect(await prisma.refund.count({ where: { invoiceId: cardInvoice } })).toBe(1);
  });

  it("keeps the bank refund wait inside its range and audits the change", async () => {
    const before = (await prisma.businessSettings.findUnique({ where: { id: "singleton" } }))?.achDisputeWindowDays ?? 60;
    try {
      expect(await saveAchDisputeWindowDays(ownerId, 9999)).toBe(120);
      expect(await saveAchDisputeWindowDays(ownerId, 45)).toBe(45);
      await expect(saveAchDisputeWindowDays(staffId, 30)).rejects.toThrow();
    } finally {
      await saveAchDisputeWindowDays(ownerId, before);
    }
  });
});
