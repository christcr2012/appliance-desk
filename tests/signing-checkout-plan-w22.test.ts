import { describe, expect, it } from "vitest";
import type { FrozenSigningEvidence } from "@/domains/billing/signing-frozen-evidence";
import { buildFrozenSigningCheckoutPlan } from "@/domains/billing/signing-checkout-plan";

const sha = "a".repeat(64);
function frozen(id: string, fee: number, tax: number, down: number): FrozenSigningEvidence {
  return {schemaVersion: 1, agreementId: id, serviceAddressId: `addr-${id}`,
    agreementVersion: 1, sourceFingerprint: "b".repeat(64), orderFingerprint: sha,
    setupFeeCents: fee, setupTaxCents: tax, downPaymentCents: down,
    allInCents: fee + tax + down, jurisdictions: []};
}
describe("W-22 signing payment line plan", () => {
  it("separates per-agreement fee, tax and first-bill down payment", () => {
    const plan = buildFrozenSigningCheckoutPlan([frozen("a", 4500, 300, 6000), frozen("b", 4500, 200, 9000)], "a");
    expect(plan.allInCents).toBe(10800);
    expect(plan.items.map(x => [x.kind, x.amountCents])).toEqual([
      ["ADMIN_SETUP_FEE", 4500], ["ADMIN_SETUP_TAX", 300], ["FIRST_MONTH_DOWN_PAYMENT", 6000],
    ]);
    expect(plan.orderFingerprint).toBe(sha);
  });
  it("does not charge down payment to the other address", () => {
    const plan = buildFrozenSigningCheckoutPlan([frozen("a", 4500, 0, 0), frozen("b", 4500, 0, 9000)], "a");
    expect(plan.allInCents).toBe(4500);
    expect(plan.items).toHaveLength(1);
  });
  it("accepts a fully waived fee as zero payable, not a fabricated checkout", () => {
    expect(buildFrozenSigningCheckoutPlan([frozen("a", 0, 0, 0)], "a").items).toEqual([]);
  });
  it("refuses missing scope, duplicate siblings, mismatched fingerprint and invalid arithmetic", () => {
    const a = frozen("a", 4500, 0, 0);
    expect(() => buildFrozenSigningCheckoutPlan([a], "b")).toThrow(/outside/);
    expect(() => buildFrozenSigningCheckoutPlan([a, a], "a")).toThrow(/complete/i);
    expect(() => buildFrozenSigningCheckoutPlan([a, {...frozen("b", 4500, 0, 0), orderFingerprint: "c".repeat(64)}], "a")).toThrow(/complete/i);
    expect(() => buildFrozenSigningCheckoutPlan([{...a, allInCents: 200}], "a")).toThrow(/reconcile/);
    expect(() => buildFrozenSigningCheckoutPlan([{...a, setupTaxCents: -1}], "a")).toThrow(/complete/i);
    expect(() => buildFrozenSigningCheckoutPlan([{...a, setupFeeCents: Number.MAX_SAFE_INTEGER}], "a")).toThrow(/reconcile/);
  });
});
