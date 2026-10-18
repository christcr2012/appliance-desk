// PLAN scenario 4 (BATCH-F WU-F3): one check pays two invoices oldest-first and overpays; the overpayment becomes account
// credit (never lost, never counted twice); a refund is recorded against the paid invoice within what was paid; and the
// customer's statement, the owner's invoice view and the receipt all agree to the cent. All amounts are integer cents.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
let owner = "";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { recordManualPayment } from "@/domains/billing/manual-payments";
import { issueInvoiceRefund } from "@/domains/billing/refunds";
import { getCustomerStatement } from "@/domains/billing/statements";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);
const tag = randomUUID().replaceAll("-", "");

describe.skipIf(!enabled)("scenario 4: manual payment, overpayment, refund and statement", () => {
  let customerId = "";
  let otherCustomerId = "";
  const invoiceIds: string[] = [];

  async function invoice(amountCents: number, dueDaysAgo: number, forCustomer = customerId) {
    const row = await prisma.invoice.create({
      data: {
        customerId: forCustomer, status: "OPEN", subtotalCents: amountCents, amountDueCents: amountCents, amountPaidCents: 0,
        dueDate: new Date(Date.now() - dueDaysAgo * 86_400_000),
        lineItems: { create: { kind: "RENTAL", description: "Monthly rent", amountCents } },
      },
    });
    invoiceIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    for (const label of ["a", "b"]) {
      const user = await prisma.user.create({ data: { email: `s4-${label}-${tag}@test.invalid`, name: `Scenario Four ${label}`, role: "CUSTOMER", emailVerified: true } });
      const customer = await prisma.customer.create({ data: { userId: user.id, referralCode: `S4${label}${tag.slice(0, 14)}` } });
      if (label === "a") customerId = customer.id;
      else otherCustomerId = customer.id;
    }
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    // Throwaway-database tidy-up for this scenario's own records.
    const refunds = await prisma.refund.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: [customerId, otherCustomerId] } } });
    await prisma.refund.deleteMany({ where: { id: { in: refunds.map((r) => r.id) } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: [customerId, otherCustomerId] } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  });

  it("pays oldest first, turns the overpayment into credit, refunds within what was paid and keeps every view in agreement", async () => {
    const older = await invoice(6000, 30);
    const newer = await invoice(3500, 5);
    const stranger = await invoice(4000, 3, otherCustomerId);

    // 1. One $100.00 check: $60.00 to the older invoice, $35.00 to the newer, $5.00 over.
    const paid = await recordManualPayment(customerId, owner, { amountCents: 10_000, method: "check", reference: `S4-${tag}`, receivedOn: new Date() });
    expect(paid).toMatchObject({ totalAppliedCents: 9500, overpaymentCents: 500 });
    expect(paid.invoicesTouched.map((row) => [row.invoiceId, row.appliedCents, row.newStatus])).toEqual([[older.id, 6000, "PAID"], [newer.id, 3500, "PAID"]]);
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { customerId }, include: { payments: true } });
    expect(receipt.amountCents).toBe(10_000);
    expect(receipt.payments.reduce((sum, row) => sum + row.amountCents, 0)).toBe(9500);
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId } });
    expect(credit).toMatchObject({ amountCents: 500, remainingCents: 500, sourceType: "RECEIPT_OVERPAYMENT" });
    // Receipt = applied + credit: nothing lost and nothing counted twice.
    expect(receipt.payments.reduce((sum, row) => sum + row.amountCents, 0) + credit.amountCents).toBe(receipt.amountCents);
    // Another customer's invoice is untouched by this payment.
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: stranger.id } })).amountPaidCents).toBe(0);

    // 2. Re-recording against an invoice that is already paid is refused; the ledger does not move.
    await expect(recordManualPayment(customerId, owner, { amountCents: 6000, method: "check", invoiceId: older.id })).rejects.toThrow(/isn't open/);
    expect(await prisma.receipt.count({ where: { customerId } })).toBe(1);

    // 3. A refund of part of the older invoice is recorded once; more than was paid is refused.
    const refund = await issueInvoiceRefund(owner, { invoiceId: older.id, amountCents: 1000, reason: "GOODWILL", notes: "Scenario four goodwill" });
    expect(refund.providerOpId).toBeNull(); // paid by check: no card refund is made
    await expect(issueInvoiceRefund(owner, { invoiceId: older.id, amountCents: 5500, reason: "BILLING_ERROR" })).rejects.toThrow(/exceeds the invoice amount still eligible/);
    expect(await prisma.refund.count({ where: { invoiceId: older.id } })).toBe(1);
    await expect(issueInvoiceRefund(owner, { invoiceId: stranger.id, amountCents: 100, reason: "OTHER" })).rejects.toThrow(/exceeds/);

    // 4. A new open invoice appears; the customer's statement and the owner's invoice view agree to the cent.
    const third = await invoice(2000, 1);
    const statement = await getCustomerStatement(customerId, { customerVisible: true });
    expect(statement).not.toBeNull();
    expect(statement!.reconciliation).toMatchObject({
      invoicedCents: 6000 + 3500 + 2000, paymentsAppliedCents: 9500, closingBalanceCents: 2000, refundedCents: 1000, creditAvailableCents: 500, balanced: true,
    });
    expect(statement!.totalBalanceCents).toBe(2000);
    expect(statement!.openInvoiceCount).toBe(1);
    const detailOlder = await getInvoiceDetail(older.id);
    const detailThird = await getInvoiceDetail(third.id);
    expect(detailOlder).toMatchObject({ status: "PAID", amountDueCents: 6000, amountPaidCents: 6000, balanceCents: 0 });
    expect(detailThird).toMatchObject({ status: "OPEN", amountDueCents: 2000, balanceCents: 2000 });
    expect((detailOlder!.balanceCents + detailThird!.balanceCents)).toBe(statement!.totalBalanceCents);
    // The customer's own view refuses another customer's invoice.
    expect(await getInvoiceDetail(stranger.id, { customerId })).toBeNull();

    // 5. Audit: each paid invoice has its own payment row and the refund is tied to its authorizer.
    for (const id of [older.id, newer.id]) {
      expect(await prisma.auditLog.count({ where: { entityType: "Invoice", entityId: id, action: "billing.manual_payment" } })).toBe(1);
    }
    expect((await prisma.refund.findFirstOrThrow({ where: { invoiceId: older.id } })).authorizedByUserId).toBe(owner);
  });
});
