import { describe, expect, it } from "vitest";
import { createDraftAgreement } from "@/domains/agreements";
import { updateBusinessSettings } from "@/domains/settings";
import { classifyLateFeeAgreement } from "@/domains/billing/late-fee-rules";

// FEE-1: the 10-day and $15 limits hold for new agreements and for the owner's settings, before anything is saved.
describe("late fee terms are refused before anything is saved", () => {
  const base = { customerId: "c1", serviceAddressId: "a1" };
  it("a new agreement cannot say fewer than 10 days", async () => {
    await expect(createDraftAgreement("u1", { ...base, lateFeeGraceDays: 5 })).rejects.toThrow(/at least 10 days/);
    await expect(createDraftAgreement("u1", { ...base, lateFeeGraceDays: 0 })).rejects.toThrow(/at least 10 days/);
  });
  it("a new agreement cannot charge more than $15", async () => {
    await expect(createDraftAgreement("u1", { ...base, lateFeeCents: 1501 })).rejects.toThrow(/at most \$15/);
  });
  it("the owner's settings refuse the same limits", async () => {
    await expect(updateBusinessSettings("u1", { lateFeeGraceDays: 9 })).rejects.toThrow();
    await expect(updateBusinessSettings("u1", { lateFeeFlatCents: 1600 })).rejects.toThrow();
  });
  it("household over 4 months is a consumer lease; a company is business", () => {
    const home = { isBusiness: false, isPropertyManager: false, companyName: null };
    expect(classifyLateFeeAgreement({ ...home, termMonths: 6 })).toBe("CONSUMER_LEASE");
    expect(classifyLateFeeAgreement({ ...home, companyName: "Acme", termMonths: 6 })).toBe("BUSINESS");
  });
});
