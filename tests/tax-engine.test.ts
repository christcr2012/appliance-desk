import { describe, expect, it } from "vitest";

import {
  categoryForLineKind,
  type TaxChargeCategory,
} from "@/domains/tax/categories";
import {
  computeTax,
  resolveTaxability,
  type EngineJurisdiction,
} from "@/domains/tax/engine";

const taxDate = new Date("2026-10-06T12:00:00.000Z");

function jurisdiction(
  overrides: Partial<EngineJurisdiction> & Pick<EngineJurisdiction, "id" | "name">,
): EngineJurisdiction {
  return {
    code: overrides.id.toUpperCase(),
    administration: "STATE_COLLECTED",
    rate: { versionId: \`rate-\${overrides.id}\`, rateMilliPercent: 1000 },
    rules: {},
    ...overrides,
  };
}

describe("categoryForLineKind", () => {
  it.each([
    ["RENTAL", 100, "RENTAL"],
    ["LATE_RETURN", 100, "LATE_RETURN"],
    ["LATE_RETURN_WAIVER", -100, "LATE_RETURN"],
    ["DELIVERY_FEE", 100, "DELIVERY"],
    ["INSTALLATION_FEE", 100, "INSTALLATION"],
    ["REMOVAL_FEE", 100, "REMOVAL"],
    ["DAMAGE_WAIVER", 100, "DAMAGE_WAIVER"],
    ["EARLY_TERMINATION_FEE", 100, "EARLY_TERMINATION"],
    ["LATE_FEE", 100, "LATE_PAYMENT_FEE"],
    ["ADJUSTMENT", -100, "FOLLOWS_PARENT"],
    ["PREPAY_DISCOUNT", -100, "FOLLOWS_PARENT"],
    ["ADJUSTMENT", 100, "OTHER_CHARGE"],
    ["ADJUSTMENT", 0, "NOT_TAXABLE"],
    ["CREDIT", -100, "NOT_TAXABLE"],
    ["DEPOSIT", 100, "NOT_TAXABLE"],
    ["TAX", 100, "NOT_TAXABLE"],
  ] as const)("%s maps to %s", (kind, amountCents, expected) => {
    expect(categoryForLineKind(kind, amountCents)).toBe(expected);
  });
});

describe("resolveTaxability", () => {
  const defaultRules: Partial<Record<TaxChargeCategory, "TAXABLE" | "EXEMPT" | "UNDECIDED">> = {
    DELIVERY: "EXEMPT",
  };

  it("lets an explicit decided jurisdiction rule win first", () => {
    const result = resolveTaxability(
      jurisdiction({
        id: "city",
        name: "Test City",
        administration: "SELF_COLLECTED",
        rules: { RENTAL: "EXEMPT" },
      }),
      "RENTAL",
      {
        election: "COLLECT_ON_RENTALS",
        defaultRules,
        leaseTermMonths: 12,
      },
    );
    expect(result.taxability).toBe("EXEMPT");
  });

  it("does not inherit defaults or the election into a self-collected jurisdiction", () => {
    const result = resolveTaxability(
      jurisdiction({
        id: "city",
        name: "Test City",
        administration: "SELF_COLLECTED",
      }),
      "RENTAL",
      {
        election: "COLLECT_ON_RENTALS",
        defaultRules: { RENTAL: "TAXABLE" },
        leaseTermMonths: 12,
      },
    );
    expect(result.taxability).toBe("UNDECIDED");
  });

  it("applies the short-term election only to state-collected rent", () => {
    const state = jurisdiction({ id: "state", name: "Test State" });

    expect(
      resolveTaxability(state, "RENTAL", {
        election: "PAY_ON_ACQUISITION",
        defaultRules,
        leaseTermMonths: null,
      }).taxability,
    ).toBe("EXEMPT");

    expect(
      resolveTaxability(state, "LATE_RETURN", {
        election: "PAY_ON_ACQUISITION",
        defaultRules,
        leaseTermMonths: 36,
      }).taxability,
    ).toBe("EXEMPT");

    expect(
      resolveTaxability(state, "RENTAL", {
        election: "PAY_ON_ACQUISITION",
        defaultRules,
        leaseTermMonths: 37,
      }).taxability,
    ).toBe("TAXABLE");

    expect(
      resolveTaxability(state, "RENTAL", {
        election: "COLLECT_ON_RENTALS",
        defaultRules,
        leaseTermMonths: 12,
      }).taxability,
    ).toBe("TAXABLE");

    expect(
      resolveTaxability(state, "RENTAL", {
        election: "UNDECIDED",
        defaultRules,
        leaseTermMonths: 12,
      }).taxability,
    ).toBe("UNDECIDED");
  });

  it("falls back to the default rule for other state-collected categories", () => {
    expect(
      resolveTaxability(
        jurisdiction({ id: "state", name: "Test State" }),
        "DELIVERY",
        {
          election: "UNDECIDED",
          defaultRules,
          leaseTermMonths: 12,
        },
      ).taxability,
    ).toBe("EXEMPT");
  });
});

describe("computeTax", () => {
  it("can exempt state rent while taxing the same rent in a self-collected city", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: null,
      election: "PAY_ON_ACQUISITION",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [
        jurisdiction({ id: "state", name: "State area" }),
        jurisdiction({
          id: "city",
          name: "Home-rule city",
          administration: "SELF_COLLECTED",
          rate: { versionId: "rate-city", rateMilliPercent: 2000 },
          rules: { RENTAL: "TAXABLE" },
        }),
      ],
      lines: [{ key: "rent", kind: "RENTAL", amountCents: 10_000 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      expect.objectContaining({
        jurisdictionId: "state",
        exemptCents: 10_000,
        taxCents: 0,
      }),
      expect.objectContaining({
        jurisdictionId: "city",
        taxableCents: 10_000,
        taxCents: 200,
      }),
    ]);
    expect(result.totalTaxCents).toBe(200);
  });

  it("taxes a 37-month state-collected rental under PAY_ON_ACQUISITION", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 37,
      election: "PAY_ON_ACQUISITION",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [jurisdiction({ id: "state", name: "State area" })],
      lines: [{ key: "rent", kind: "RENTAL", amountCents: 10_000 }],
    });
    expect(result).toMatchObject({ ok: true, totalTaxCents: 100 });
  });

  it("scopes a customer exemption to only the named jurisdiction", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 12,
      election: "COLLECT_ON_RENTALS",
      defaultRules: {},
      exemptJurisdictionIds: new Set(["state-a"]),
      jurisdictions: [
        jurisdiction({ id: "state-a", name: "State A" }),
        jurisdiction({ id: "state-b", name: "State B" }),
      ],
      lines: [{ key: "rent", kind: "RENTAL", amountCents: 10_000 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.find((line) => line.jurisdictionId === "state-a")).toMatchObject({
      exemptCents: 10_000,
      taxCents: 0,
      exemptReason: "Customer exemption certificate",
    });
    expect(result.lines.find((line) => line.jurisdictionId === "state-b")).toMatchObject({
      taxableCents: 10_000,
      taxCents: 100,
    });
  });

  it("makes a negative adjustment follow its parent category", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 12,
      election: "COLLECT_ON_RENTALS",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [jurisdiction({ id: "state", name: "State area" })],
      lines: [
        { key: "rent", kind: "RENTAL", amountCents: 10_000 },
        {
          key: "discount",
          kind: "ADJUSTMENT",
          amountCents: -1_000,
          parentKey: "rent",
        },
      ],
    });
    expect(result).toMatchObject({ ok: true, totalTaxCents: 90 });
  });

  it("does not tax account credit or reduce the taxable charge", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 12,
      election: "COLLECT_ON_RENTALS",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [jurisdiction({ id: "state", name: "State area" })],
      lines: [
        { key: "rent", kind: "RENTAL", amountCents: 10_000 },
        { key: "credit", kind: "CREDIT", amountCents: -5_000 },
      ],
    });
    expect(result).toMatchObject({ ok: true, totalTaxCents: 100 });
  });

  it("returns all policy problems instead of stopping at the first one", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 12,
      election: "COLLECT_ON_RENTALS",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [
        jurisdiction({
          id: "missing-rate",
          name: "No Rate County",
          rate: null,
        }),
        jurisdiction({
          id: "undecided-city",
          name: "Undecided City",
          administration: "SELF_COLLECTED",
        }),
      ],
      lines: [{ key: "rent", kind: "RENTAL", amountCents: 10_000 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "No rate entered for No Rate County on 2026-10-06",
        "Rental in Undecided City: not decided yet",
      ]),
    );
    expect(result.problems).toHaveLength(2);
  });

  it("deduplicates the same policy problem across multiple lines", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 12,
      election: "COLLECT_ON_RENTALS",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [
        jurisdiction({ id: "missing-rate", name: "No Rate County", rate: null }),
      ],
      lines: [
        { key: "rent-a", kind: "RENTAL", amountCents: 1_000 },
        { key: "rent-b", kind: "RENTAL", amountCents: 2_000 },
      ],
    });
    expect(result).toEqual({
      ok: false,
      problems: ["No rate entered for No Rate County on 2026-10-06"],
    });
  });

  it("rounds a 7.01% two-jurisdiction line independently per jurisdiction", () => {
    const result = computeTax({
      taxDate,
      leaseTermMonths: 12,
      election: "COLLECT_ON_RENTALS",
      defaultRules: {},
      exemptJurisdictionIds: new Set(),
      jurisdictions: [
        jurisdiction({
          id: "state",
          name: "State",
          rate: { versionId: "rate-state", rateMilliPercent: 2900 },
        }),
        jurisdiction({
          id: "city",
          name: "City",
          administration: "SELF_COLLECTED",
          rate: { versionId: "rate-city", rateMilliPercent: 4110 },
          rules: { RENTAL: "TAXABLE" },
        }),
      ],
      lines: [{ key: "rent", kind: "RENTAL", amountCents: 6_499 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.map((line) => line.taxCents)).toEqual([188, 267]);
    expect(result.totalTaxCents).toBe(455);
  });
});
