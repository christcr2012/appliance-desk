import { describe, expect, it } from "vitest";
import {
  composePaymentLinkMessage, DEFAULT_TEMPLATES, overdueDays, suggestPaymentLinkReason, templateFor, validateTemplate,
  PAYMENT_LINK_REASONS, type PaymentLinkFacts,
} from "@/domains/billing/payment-link-message";

const facts: PaymentLinkFacts = {
  customerName: "Pat Renter", what: "Washer rental", owedCents: 5000, dueOnKey: "2026-10-10", todayKey: "2026-10-16",
  lateFeeCents: 500, totalBalanceCents: 12000, link: "https://pay.example.test/i/abc",
};

describe("payment link message", () => {
  it("fills every fact: what, amount, due date, days overdue, late fee, total balance and the link", () => {
    const m = composePaymentLinkMessage({ reason: "REMINDER", template: DEFAULT_TEMPLATES.REMINDER, facts });
    expect(m.text).toContain("Pat Renter");
    expect(m.text).toContain("Washer rental");
    expect(m.text).toContain("$50.00");
    expect(m.text).toContain("It was due October 10, 2026.");
    expect(m.text).toContain("6 days overdue and a late fee of $5.00");
    expect(m.text).toContain("$120.00");
    expect(m.text).toContain("https://pay.example.test/i/abc");
    expect(m.text).not.toMatch(/\{\w+\}/);
  });
  it("leaves out overdue and balance wording when they don't apply, and adds the owner's note", () => {
    const m = composePaymentLinkMessage({ reason: "PARTIAL", template: DEFAULT_TEMPLATES.PARTIAL,
      facts: { ...facts, dueOnKey: "2026-10-20", lateFeeCents: 0, totalBalanceCents: 5000 }, note: "Thanks for your patience" });
    expect(m.text).toContain("It is due October 20, 2026.");
    expect(m.text).not.toContain("overdue");
    expect(m.text).not.toContain("total balance");
    expect(m.text).toContain("Note from us: Thanks for your patience");
  });
  it("every reason has a valid recommended wording", () => {
    for (const r of PAYMENT_LINK_REASONS) expect(validateTemplate(DEFAULT_TEMPLATES[r])).toBeNull();
  });
  it("refuses a link that is not https", () => {
    expect(() => composePaymentLinkMessage({ reason: "REMINDER", template: DEFAULT_TEMPLATES.REMINDER, facts: { ...facts, link: "http://x.test" } })).toThrow(/https/);
  });
  it("validates owner wording", () => {
    expect(validateTemplate("short {link}")).toMatch(/30 and 1500/);
    expect(validateTemplate("x".repeat(40))).toMatch(/\{link\}/);
    expect(validateTemplate("Hello {customer}, pay at {link} {bogus} please thanks")).toMatch(/\{bogus\}/);
    expect(validateTemplate("Hello {customer}, pay at {link} thanks so much, bye")).toBeNull();
  });
  it("uses the owner's wording when valid and falls back when it is not", () => {
    const own = "Hello {customer}, pay {amount} at {link} thanks so much";
    expect(templateFor("REMINDER", { REMINDER: own })).toBe(own);
    expect(templateFor("REMINDER", { REMINDER: "bad" })).toBe(DEFAULT_TEMPLATES.REMINDER);
    expect(templateFor("FAILED", null)).toBe(DEFAULT_TEMPLATES.FAILED);
  });
  it("suggests a reason from the invoice and counts overdue days", () => {
    expect(suggestPaymentLinkReason({ status: "DELINQUENT", amountPaidCents: 0 })).toBe("FAILED");
    expect(suggestPaymentLinkReason({ status: "OPEN", amountPaidCents: 100 })).toBe("PARTIAL");
    expect(suggestPaymentLinkReason({ status: "OPEN", amountPaidCents: 0 })).toBe("REMINDER");
    expect(overdueDays("2026-10-10", "2026-10-09")).toBe(0);
    expect(overdueDays(null, "2026-10-09")).toBe(0);
  });
});

import { pastDueInvoiceException } from "@/domains/exceptions/rules";
describe("failed payment To do", () => {
  it("is titled with the customer and amount and opens the invoice", () => {
    const item = pastDueInvoiceException({ id: "inv1", customerId: "c1", customerName: "Pat Renter", status: "DELINQUENT",
      dueDate: new Date("2026-10-01T12:00:00Z"), amountDueCents: 7550, amountPaidCents: 0 });
    expect(item.title).toBe("Pat Renter's payment failed — $75.50");
    expect(item.href).toContain("inv1");
  });
});
