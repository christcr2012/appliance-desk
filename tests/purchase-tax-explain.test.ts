import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { explainPendingPurchaseTax } from "@/domains/tax/purchase-tax-explain";

function fake(
  opts: { choice?: "LATER" | "NONE_CHARGED"; missingContext?: boolean; gone?: boolean;
    election?: "UNDECIDED" | "PAY_ON_ACQUISITION"; location?: "MISSING" | "VERIFIED";
    reviewed?: boolean; status?: "UNKNOWN" | "USE_TAX_DUE" } = {},
) {
  const a = {
    acquisitionTaxStatus: opts.status ?? "UNKNOWN",
    acquisitionTaxChoice: opts.choice ?? "NONE_CHARGED",
    purchaseDate: opts.missingContext ? null : new Date("2026-09-01"),
    acquisitionCostCents: opts.missingContext ? null : 10000,
  };
  const location = opts.location === "MISSING" ? null : {
    status: "VERIFIED",
    jurisdictions: [{
      jurisdiction: { reviewStatus: opts.reviewed === false ? "NEEDS_REVIEW" : "REVIEWED",
        rates: opts.reviewed === false ? [] : [{ rateMilliPercent: 5000 }] },
    }],
  };
  const tx = {
    appliance: { findUnique: vi.fn().mockResolvedValue(opts.gone ? null : a) },
    businessSettings: { findUnique: vi.fn().mockResolvedValue({
      shortTermLeaseElection: opts.election ?? "PAY_ON_ACQUISITION",
    }) },
    addressTaxLocation: { findFirst: vi.fn().mockResolvedValue(location) },
  } as unknown as Prisma.TransactionClient;
  return tx;
}

describe("W-0A purchase-tax explanation links", () => {
  it.each([
    ["ANSWER_LATER", { choice: "LATER" }, "/desk/inventory/one"],
    ["PURCHASE_DATE_OR_COST_MISSING", { missingContext: true }, "/desk/inventory/one"],
    ["ELECTION_UNDECIDED", { election: "UNDECIDED" }, "/desk/sales-tax/setup#decisions"],
    ["BUSINESS_ADDRESS_UNVERIFIED", { location: "MISSING" }, "/desk/sales-tax/setup#business-tax-address"],
    ["RATES_UNREVIEWED", { reviewed: false }, "/desk/sales-tax/areas#rates"],
  ] as const)("returns %s with action link", async (reason, options, href) => {
    const result = await explainPendingPurchaseTax(fake(options), "one");
    expect(result).toMatchObject({ reason, fixHref: href });
    expect(result.fixLabel).toBeTruthy();
  });
  it("has no pending cause, and does not throw, when the appliance was removed meanwhile", async () => {
    expect(await explainPendingPurchaseTax(fake({ gone: true }), "one")).toEqual({ reason: null, fixHref: null, fixLabel: null });
  });

  it("has no pending cause when the tax is already classified", async () => {
    expect(await explainPendingPurchaseTax(fake({ status: "USE_TAX_DUE" }), "one"))
      .toEqual({ reason: null, fixHref: null, fixLabel: null });
  });
});
