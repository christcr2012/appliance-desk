import { describe, expect, it } from "vitest";
import { packagePartsProblem } from "@/domains/packages/pricing";
import { renewalCreateData } from "@/domains/agreements/renewal-data";

const parts = [
  { applianceTypeId: "w", name: "Washer", quantity: 1 },
  { applianceTypeId: "d", name: "Dryer", quantity: 1 },
];
const washer = { applianceTypeId: "w", name: "Washer" };
const dryer = { applianceTypeId: "d", name: "Dryer" };

describe("one machine per part of a set (W-16B)", () => {
  it("accepts exactly the listed machines in any order", () => {
    expect(packagePartsProblem("Washer + Dryer Set", parts, [dryer, washer])).toBeNull();
  });

  it("explains what is missing or extra in plain words", () => {
    expect(packagePartsProblem("Washer + Dryer Set", parts, [washer, washer])).toBe(
      "Washer + Dryer Set needs exactly Washer + Dryer. You picked 2 × Washer.",
    );
    expect(packagePartsProblem("Washer + Dryer Set", parts, [washer])).toMatch(/You picked Washer\.$/);
    expect(packagePartsProblem("Washer + Dryer Set", parts, [washer, dryer, { applianceTypeId: "f", name: "Fridge" }])).toMatch(
      /You picked Washer \+ Dryer \+ Fridge\./,
    );
    expect(packagePartsProblem("Washer + Dryer Set", parts, [])).toMatch(/You picked nothing\./);
  });
});

describe("renewals keep a set a set", () => {
  it("copies each line's package", () => {
    const data = renewalCreateData(
      {
        id: "a1",
        customerId: "c1",
        serviceAddressId: "s1",
        depositCents: 0,
        damageWaiverCents: 0,
        lateFeeGraceDays: 5,
        lateFeeCents: 0,
        lateFeePercent: 0,
        endDate: new Date("2027-01-01T00:00:00Z"),
        continuityRootId: null,
        continuousSince: null,
        firstDeliveredOn: null,
      } as Parameters<typeof renewalCreateData>[0],
      [
        { label: "Set", monthlyPriceCents: 6000, listPriceCents: 6000, prepayDiscountCentsPerMonth: 0, packageId: "pkg" },
        { label: "Washer", monthlyPriceCents: 3500, listPriceCents: 3500, prepayDiscountCentsPerMonth: 0 },
      ],
      { termMonths: null },
    );
    const lines = (data.lines as { create: { packageId: string | null }[] }).create;
    expect(lines.map((l) => l.packageId)).toEqual(["pkg", null]);
  });
});
