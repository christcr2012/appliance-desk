import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  customerFind: vi.fn(),
  invoiceFind: vi.fn(),
  hosted: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { customer: { findUnique: mocks.customerFind }, invoice: { findFirst: mocks.invoiceFind } } }));
vi.mock("@/domains/billing/payment-link", () => ({ getHostedPaymentUrl: mocks.hosted }));
vi.mock("@/lib/session", () => ({ getServerSession: mocks.session }));

import { describeRentalLine } from "@/domains/portal/line-display";
import { rentForNextBill } from "@/domains/portal/next-bill";
import { getPayNowUrl, isPayNowEligible, PayNowError } from "@/domains/portal/pay-now";
import { POST } from "@/app/account/billing/invoice/[invoiceId]/pay/route";
import { PORTAL_TRANSLATIONS, portalLabel } from "@/domains/language/portal-copy";

const NOW = new Date("2026-10-17T18:00:00Z");
const yesterday = new Date("2026-10-15T18:00:00Z");
const tomorrow = new Date("2026-10-20T18:00:00Z");
const open = { status: "OPEN", dueDate: yesterday, balanceCents: 6000, isLocalInvoice: false };

beforeEach(() => { Object.values(mocks).forEach((m) => m.mockReset()); });

describe("W-20 package sets and next bill", () => {
  it("shows a package line as one set with its machines", () => {
    expect(describeRentalLine({ label: "Washer + Dryer Set", packageId: "p1", assignments: [
      { appliance: { assetNumber: "A12", applianceType: { name: "Washer" } } },
      { appliance: { assetNumber: "B07", applianceType: { name: "Dryer" } } },
    ] })).toBe("Washer + Dryer Set (washer #A12, dryer #B07)");
    expect(describeRentalLine({ label: "Refrigerator", packageId: null, assignments: [] })).toBe("Refrigerator");
  });
  it("adds up the rent actually charged per month", () => {
    expect(rentForNextBill([{ monthlyPriceCents: 6000 }, { monthlyPriceCents: 3500 }])).toBe(9500);
    expect(rentForNextBill([])).toBe(0);
  });
});

describe("W-20 Pay now rules", () => {
  it("is offered only for an overdue, payable, Stripe-backed invoice with a balance", () => {
    expect(isPayNowEligible(open, NOW)).toBe(true);
    expect(isPayNowEligible({ ...open, status: "DELINQUENT", dueDate: null }, NOW)).toBe(true);
    expect(isPayNowEligible({ ...open, dueDate: tomorrow }, NOW)).toBe(false);
    expect(isPayNowEligible({ ...open, status: "PAID" }, NOW)).toBe(false);
    expect(isPayNowEligible({ ...open, status: "VOID" }, NOW)).toBe(false);
    expect(isPayNowEligible({ ...open, balanceCents: 0 }, NOW)).toBe(false);
    expect(isPayNowEligible({ ...open, isLocalInvoice: true }, NOW)).toBe(false);
  });

  it("looks the invoice up through the signed-in customer, so someone else's bill is just not found", async () => {
    mocks.customerFind.mockResolvedValue({ id: "cust-1", archivedAt: null });
    mocks.invoiceFind.mockResolvedValue(null);
    await expect(getPayNowUrl("user-1", "inv-of-someone-else", NOW)).rejects.toBeInstanceOf(PayNowError);
    expect(mocks.invoiceFind.mock.calls[0][0].where).toEqual({ id: "inv-of-someone-else", customerId: "cust-1" });
    expect(mocks.hosted).not.toHaveBeenCalled();
  });

  it("sends an eligible customer to Stripe's page for exactly the amount owed", async () => {
    mocks.customerFind.mockResolvedValue({ id: "cust-1", archivedAt: null });
    mocks.invoiceFind.mockResolvedValue({ status: "OPEN", dueDate: yesterday, amountDueCents: 6000, amountPaidCents: 1000, stripeInvoiceId: "in_test" });
    mocks.hosted.mockResolvedValue("https://invoice.stripe.com/i/test");
    await expect(getPayNowUrl("user-1", "inv-1", NOW)).resolves.toBe("https://invoice.stripe.com/i/test");
    expect(mocks.hosted).toHaveBeenCalledWith("in_test", 5000);
  });

  it("offers nothing for a paid or local invoice and hides Stripe errors", async () => {
    mocks.customerFind.mockResolvedValue({ id: "cust-1", archivedAt: null });
    mocks.invoiceFind.mockResolvedValue({ status: "PAID", dueDate: yesterday, amountDueCents: 6000, amountPaidCents: 6000, stripeInvoiceId: "in_test" });
    await expect(getPayNowUrl("user-1", "inv-1", NOW)).rejects.toThrow(/can't be paid online/);
    mocks.invoiceFind.mockResolvedValue({ status: "OPEN", dueDate: yesterday, amountDueCents: 6000, amountPaidCents: 0, stripeInvoiceId: null });
    await expect(getPayNowUrl("user-1", "inv-1", NOW)).rejects.toThrow(/can't be paid online/);
    mocks.invoiceFind.mockResolvedValue({ status: "OPEN", dueDate: yesterday, amountDueCents: 6000, amountPaidCents: 0, stripeInvoiceId: "in_test" });
    mocks.hosted.mockRejectedValue(new Error("Stripe secret detail"));
    await expect(getPayNowUrl("user-1", "inv-1", NOW)).rejects.toThrow(/isn't available right now/);
  });

  it("the pay route sends signed-out visitors to login and failures back to the invoice", async () => {
    const request = () => new Request("https://example.test/account/billing/invoice/inv-1/pay", { method: "POST" });
    const ctx = { params: Promise.resolve({ invoiceId: "inv-1" }) };
    mocks.session.mockResolvedValue(null);
    const out = await POST(request(), ctx);
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toContain("/login");
    mocks.session.mockResolvedValue({ user: { id: "user-1" } });
    mocks.customerFind.mockResolvedValue(null);
    const failed = await POST(request(), ctx);
    expect(failed.headers.get("location")).toContain("/account/billing/invoice/inv-1?payError=1");
  });
});

describe("W-20 Spanish copy", () => {
  it("every new customer sentence has a Spanish version", () => {
    for (const text of ["Your next bill", "Your open visits", "Requested", "Scheduled", "Done", "Not scheduled yet", "Pay now",
      "We received your problem report. We will review it and contact you to arrange a repair visit. Nothing is charged for reporting a problem.",
      "Your request to end the rental was recorded. We will arrange pickup and confirm the final day. The final bill is shown in Billing."] as (keyof typeof PORTAL_TRANSLATIONS)[]) {
      expect(PORTAL_TRANSLATIONS[text], text).toBeTruthy();
      expect(portalLabel("es", text)).not.toBe(text);
    }
  });
});
