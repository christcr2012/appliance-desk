import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(), emailOn: vi.fn(async () => true), deliver: vi.fn(async (a: { render: () => { text: string } }) => { a.render(); return { state: "SENT" }; }),
  role: vi.fn(async () => ({ user: { id: "x", role: "OWNER" } })),
}));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({ invoices: { retrieve: mocks.retrieve } }) }));
vi.mock("@/domains/settings/customer-email-switch", () => ({ isCustomerEmailEnabled: mocks.emailOn }));
vi.mock("@/domains/messaging/deliver", () => ({ deliverMessage: mocks.deliver }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.role }));
import { prisma } from "@/lib/prisma";
import { previewPaymentLink, sendPaymentLink, copyPaymentLink, saveTemplate, startPhonePayment, getTemplateOverrides, PaymentLinkError } from "@/domains/billing/payment-link";
import { getLeadResponseDays, saveLeadResponseDays, setLeadFollowUp, parseFollowUpKey, defaultFollowUpKey } from "@/domains/leads/follow-up";
import { listNewLeadContact, listLeadFollowUps, listApprovedQuoteToRental } from "@/domains/exceptions/lead-turning-points";
import { listHeldPaymentAttention } from "@/domains/exceptions/money-turning-points";
import { businessDateKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

describe.skipIf(!enabled)("W-5 payment links and W-6 lead To dos on real PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "w5-o-" + tag, staffId = "w5-s-" + tag, custUserId = "w5-cu-" + tag, customerId = "w5-c-" + tag;
  const invoiceIds: string[] = [], leadIds: string[] = [], estimateIds: string[] = [];
  let oldSettings: { leadResponseDays: number; paymentLinkTemplates: unknown } | null = null;
  const now = new Date();

  async function invoice(extra: Record<string, unknown> = {}) {
    const i = await prisma.invoice.create({ data: { customerId, status: "OPEN", amountDueCents: 5000, dueDate: new Date(now.getTime() - 6 * DAY),
      stripeInvoiceId: "in_" + randomUUID().replaceAll("-", ""), lineItems: { create: [{ kind: "RENTAL", description: "Washer rental", amountCents: 5000 }] }, ...extra } });
    invoiceIds.push(i.id);
    return i;
  }
  const stripeOpen = (cents: number) => mocks.retrieve.mockResolvedValue({ status: "open", amount_remaining: cents, hosted_invoice_url: "https://pay.example.test/i/" + tag });

  beforeAll(async () => {
    const s = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { leadResponseDays: true, paymentLinkTemplates: true } });
    oldSettings = s;
    await prisma.user.createMany({ data: [
      { id: ownerId, email: tag + "-o@example.test", name: "W5 Owner", role: "OWNER", emailVerified: true },
      { id: staffId, email: tag + "-s@example.test", name: "W5 Staff", role: "STAFF", emailVerified: true },
      { id: custUserId, email: tag + "-c@example.test", name: "Pat Payer", role: "CUSTOMER", emailVerified: true } ] });
    await prisma.customer.create({ data: { id: customerId, userId: custUserId, referralCode: "W" + tag.slice(0, 18) } });
  });
  beforeEach(() => { mocks.emailOn.mockResolvedValue(true); mocks.deliver.mockClear(); stripeOpen(5000); });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { leadResponseDays: oldSettings?.leadResponseDays ?? 0,
      paymentLinkTemplates: oldSettings?.paymentLinkTemplates == null ? (await import("@prisma/client")).Prisma.DbNull : (oldSettings.paymentLinkTemplates as never) } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: { in: [...invoiceIds, ...leadIds] } }] } });
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, custUserId] } } });
  });

  it("previews and sends a filled message through the email switch, and audits it", async () => {
    const inv = await invoice();
    const p = await previewPaymentLink(ownerId, inv.id, "REMINDER", "Thanks!");
    expect(p.text).toContain("$50.00");
    expect(p.text).toContain("Washer rental");
    expect(p.text).toContain("Thanks!");
    expect(p.link).toBe("https://pay.example.test/i/" + tag);
    await sendPaymentLink(ownerId, inv.id, "REMINDER", { operationKey: "op-" + tag.slice(0, 10) });
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: inv.id, action: "billing.payment_link_sent" } });
    expect(audit?.userId).toBe(ownerId);
  });

  it("refuses to send when customer email is off, but Copy link still works", async () => {
    const inv = await invoice();
    mocks.emailOn.mockResolvedValue(false);
    await expect(sendPaymentLink(ownerId, inv.id, "REMINDER", { operationKey: "op-off-" + tag.slice(0, 8) })).rejects.toThrow(/turned off/);
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(await copyPaymentLink(ownerId, inv.id)).toContain("https://");
    expect(await prisma.auditLog.count({ where: { entityId: inv.id, action: "billing.payment_link_copied" } })).toBe(1);
  });

  it("has nothing to send for paid, cancelled or no-Stripe invoices, and when Stripe disagrees", async () => {
    for (const status of ["PAID", "VOID", "CANCELLED", "WRITTEN_OFF"] as const) {
      const inv = await invoice({ status }).catch(() => null);
      if (!inv) continue;
      await expect(previewPaymentLink(ownerId, inv.id, "REMINDER")).rejects.toBeInstanceOf(PaymentLinkError);
    }
    const noStripe = await invoice({ stripeInvoiceId: null });
    await expect(previewPaymentLink(ownerId, noStripe.id, "REMINDER")).rejects.toThrow(/no Stripe payment page/);
    const mismatch = await invoice();
    stripeOpen(4000);
    await expect(previewPaymentLink(ownerId, mismatch.id, "REMINDER")).rejects.toThrow(/differs/);
  });

  it("only owners and admins can use payment links; only the owner edits wording", async () => {
    const inv = await invoice();
    await expect(previewPaymentLink(staffId, inv.id, "REMINDER")).rejects.toThrow();
    await expect(startPhonePayment(staffId, inv.id, { saveCardPermission: false })).rejects.toThrow();
    await expect(saveTemplate(staffId, "REMINDER", "Hello {customer}, pay at {link} thanks so much")).rejects.toThrow();
  });

  it("saves and restores owner wording with an audit trail, rejecting bad wording", async () => {
    const text = "Hello {customer}, please pay {amount} here: {link} Thank you!";
    await expect(saveTemplate(ownerId, "FAILED", "no link here at all, just words to reach thirty")).rejects.toThrow(/\{link\}/);
    await saveTemplate(ownerId, "FAILED", text);
    expect((await getTemplateOverrides())?.FAILED).toBe(text);
    const inv = await invoice({ status: "DELINQUENT" });
    expect((await previewPaymentLink(ownerId, inv.id, "FAILED")).text).toContain("please pay $50.00 here");
    await saveTemplate(ownerId, "FAILED", null);
    expect((await getTemplateOverrides())?.FAILED).toBeUndefined();
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: { startsWith: "billing.payment_link_template." } } })).toBe(2);
  });

  it("phone payment records who started it and the card-save permission with the script, and stores no card data", async () => {
    const inv = await invoice();
    const link = await startPhonePayment(ownerId, inv.id, { saveCardPermission: true });
    expect(link).toContain("https://");
    const audit = await prisma.auditLog.findFirst({ where: { entityId: inv.id, action: "billing.phone_payment_started" } });
    expect(audit?.userId).toBe(ownerId);
    expect(audit?.newValue).toMatchObject({ amountCents: 5000, saveCardPermission: true });
    expect(JSON.stringify(audit?.newValue)).toContain("authorize Robinson Appliance Rentals");
    expect(await prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(0);
  });

  it("a held payment becomes a To do that opens the decision screen", async () => {
    const inv = await invoice({ status: "VOID" });
    const pay = await prisma.payment.create({ data: { invoiceId: inv.id, amountCents: 5000, method: "CARD", status: "held" } });
    const row = (await listHeldPaymentAttention(50)).rows.find((r) => r.title === "Pat Payer's $50.00 payment is on hold");
    expect(row?.href).toBe("/desk/billing/held-payments");
    expect(row?.primaryAction?.label).toBe("Decide");
    await prisma.payment.delete({ where: { id: pay.id } });
  });

  it("lead response time defaults to the same day, validates, audits and rejects stale saves", async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { leadResponseDays: 0 } });
    expect(await getLeadResponseDays()).toBe(0);
    await expect(saveLeadResponseDays(ownerId, 15, 0)).rejects.toThrow(/0 to 14/);
    await expect(saveLeadResponseDays(staffId, 2, 0)).rejects.toThrow();
    await saveLeadResponseDays(ownerId, 2, 0);
    await expect(saveLeadResponseDays(ownerId, 3, 0)).rejects.toThrow(/changed in another session/);
    expect(await getLeadResponseDays()).toBe(2);
    await saveLeadResponseDays(ownerId, 0, 2);
  });

  it("a new lead gets a 'Contact <name>' To do due per the setting; contacted leads leave it", async () => {
    const lead = await prisma.lead.create({ data: { contactName: "Lee Lead " + tag.slice(0, 6), phone: "970-555-0100" } });
    leadIds.push(lead.id);
    const find = async () => (await listNewLeadContact(50)).rows.find((r) => r.href.includes(lead.id));
    const row = await find();
    expect(row?.title).toBe("Contact " + lead.contactName);
    expect(row?.dueDateOnly).toBe(true);
    expect(businessDateKey(row!.dueOn!)).toBe(businessDateKey(lead.createdAt));
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { leadResponseDays: 3 } });
    expect(businessDateKey((await find())!.dueOn!)).toBe(businessDateKey(new Date(lead.createdAt.getTime() + 3 * DAY)));
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { leadResponseDays: 0 } });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
    expect(await find()).toBeUndefined();
  });

  it("the follow-up date defaults to two days out, rejects past dates, and becomes a dated To do", async () => {
    const lead = await prisma.lead.create({ data: { contactName: "Fran Follow " + tag.slice(0, 6), phone: "970-555-0101", status: "CONTACTED" } });
    leadIds.push(lead.id);
    expect(defaultFollowUpKey(now)).toBe(businessDateKey(new Date(now.getTime() + 2 * DAY)));
    expect(() => parseFollowUpKey("2020-01-01", now)).toThrow(/past/);
    expect(() => parseFollowUpKey("nope", now)).toThrow(/real/);
    const find = async () => (await listLeadFollowUps(50, now)).rows.find((r) => r.href.includes(lead.id));
    await setLeadFollowUp(ownerId, lead.id, parseFollowUpKey(defaultFollowUpKey(now), now));
    expect(await find()).toBeUndefined(); // not due yet
    await setLeadFollowUp(ownerId, lead.id, parseFollowUpKey(businessDateKey(now), now));
    const row = await find();
    expect(row?.title).toBe("Follow up with " + lead.contactName);
    expect(row?.dueDateOnly).toBe(true);
    await setLeadFollowUp(ownerId, lead.id, null);
    expect(await find()).toBeUndefined();
    await expect(setLeadFollowUp(staffId, lead.id, null)).rejects.toThrow();
  });

  it("a customer-approved quote becomes 'Turn <name>'s approved quote into a rental', due today", async () => {
    const est = await prisma.estimate.create({ data: { customerId, title: "W5 quote", createdByUserId: ownerId, status: "APPROVED", respondedAt: now } as never });
    estimateIds.push(est.id);
    const row = (await listApprovedQuoteToRental(50, now)).rows.find((r) => r.href.includes(est.id));
    expect(row?.title).toBe("Turn Pat Payer's approved quote into a rental");
    expect(businessDateKey(row!.dueOn!)).toBe(businessDateKey(now));
    await prisma.estimate.update({ where: { id: est.id }, data: { status: "CONVERTED" } });
    expect((await listApprovedQuoteToRental(50, now)).rows.find((r) => r.href.includes(est.id))).toBeUndefined();
  });
});
