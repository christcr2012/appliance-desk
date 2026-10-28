import { describe, expect, it } from "vitest";
import { paymentMethodWord, paymentPill, paymentTabStatuses } from "@/domains/billing/payment-tabs";

// AR-3 (MONEY-AREA 2): the Payments list's pure status rules.
describe("payment tab rules", () => {
  it("received takes both stored spellings, failed takes both of its spellings", () => {
    expect(paymentTabStatuses("received")).toEqual(["succeeded", "SUCCEEDED"]);
    expect(paymentTabStatuses("failed")).toEqual(["failed", "FAILED"]);
    expect(paymentTabStatuses("held")).toEqual(["held", "held_conflict"]);
  });

  it("decided held payments are in no tab (the bill timeline only)", () => {
    for (const tab of ["received", "failed", "held", "deposits", "waiting"] as const) {
      const statuses = paymentTabStatuses(tab) ?? [];
      expect(statuses).not.toContain("held_to_credit");
      expect(statuses).not.toContain("held_refunded");
    }
    expect(paymentTabStatuses("deposits")).toBeNull();
    expect(paymentTabStatuses("waiting")).toBeNull();
  });

  it("pills use the spec's words, tones and explanations", () => {
    expect(paymentPill("succeeded")).toEqual({ label: "Received", tone: "good" });
    expect(paymentPill("SUCCEEDED")).toEqual({ label: "Received", tone: "good" });
    expect(paymentPill("failed")).toEqual({ label: "Failed", tone: "attention" });
    expect(paymentPill("FAILED")).toEqual({ label: "Failed", tone: "attention" });
    expect(paymentPill("held")).toEqual({ label: "Needs a decision", tone: "attention", info: "held-payment" });
    expect(paymentPill("held_conflict")).toEqual({ label: "Check this", tone: "danger", info: "held-conflict" });
  });

  it("method words are the everyday ones", () => {
    expect(paymentMethodWord("card")).toBe("Card");
    expect(paymentMethodWord("ach")).toBe("Bank (ACH)");
    expect(paymentMethodWord("check")).toBe("Check");
    expect(paymentMethodWord("cash")).toBe("Cash");
    expect(paymentMethodWord("bank_transfer")).toBe("Bank transfer");
    expect(paymentMethodWord("other")).toBe("Other");
    expect(paymentMethodWord(null)).toBe("Other");
    expect(paymentMethodWord("something-new")).toBe("Other");
  });
});
