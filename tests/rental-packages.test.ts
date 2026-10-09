import { describe, expect, it } from "vitest";
import {
  machineCount,
  packageContents,
  packageSaving,
  packageSavingSentence,
  validatePackageInput,
} from "@/domains/packages/pricing";
import { summarizeApplianceRequests } from "@/domains/leads/requests";

const washer = { quantity: 1, monthlyPriceCents: 3500 };
const dryer = { quantity: 1, monthlyPriceCents: 3500 };

describe("rental package pricing (W-16A, D-WB3)", () => {
  it("works out the saving from the single prices, never a typed number", () => {
    expect(packageSaving(6000, [washer, dryer])).toEqual({ separateCents: 7000, savingCents: 1000 });
    expect(packageSavingSentence(6000, [washer, dryer])).toBe(
      "Renting these separately would be $70 a month; the set is $60 — the customer saves $10 a month.",
    );
  });

  it("says plainly when a set saves nothing or costs more", () => {
    expect(packageSavingSentence(7000, [washer, dryer])).toContain("no saving");
    expect(packageSavingSentence(7550, [washer, dryer])).toContain("the set costs $5.50 more");
  });

  it("treats a type added after launch exactly like the starter ones", () => {
    const chestFreezer = { quantity: 2, monthlyPriceCents: 2999, name: "Chest Freezer" };
    expect(machineCount([chestFreezer])).toBe(2);
    expect(packageContents([chestFreezer, { quantity: 1, name: "Refrigerator" }])).toBe("2 × Chest Freezer + Refrigerator");
    expect(packageSaving(5000, [chestFreezer]).savingCents).toBe(998);
    expect(
      validatePackageInput({ name: "Freezer pair", monthlyPriceCents: 5000, components: [{ applianceTypeId: "new-type", quantity: 2 }] }),
    ).toBeNull();
  });

  it("refuses inputs that cannot be a set, in plain words", () => {
    const base = { name: "Set", monthlyPriceCents: 6000, components: [{ applianceTypeId: "w", quantity: 1 }, { applianceTypeId: "d", quantity: 1 }] };
    expect(validatePackageInput(base)).toBeNull();
    expect(validatePackageInput({ ...base, name: "  " })).toMatch(/Give the set a name/);
    expect(validatePackageInput({ ...base, monthlyPriceCents: -1 })).toMatch(/\$0 or more/);
    expect(validatePackageInput({ ...base, monthlyPriceCents: 10_000_001 })).toMatch(/under \$100,000/);
    expect(validatePackageInput({ ...base, components: [{ applianceTypeId: "w", quantity: 1 }] })).toMatch(/at least two machines/);
    expect(validatePackageInput({ ...base, components: [{ applianceTypeId: "w", quantity: 1 }, { applianceTypeId: "w", quantity: 1 }] })).toMatch(/only once/);
    expect(validatePackageInput({ ...base, components: [{ applianceTypeId: "w", quantity: 11 }] })).toMatch(/between 1 and 10/);
    expect(validatePackageInput({ ...base, components: [{ applianceTypeId: "w", quantity: 0 }, { applianceTypeId: "d", quantity: 2 }] })).toMatch(/between 1 and 10/);
  });
});

describe("lead requests in words", () => {
  const set = { id: "p1", name: "Washer + Dryer Set" };
  it("puts a requested set back together and keeps single machines as they are", () => {
    expect(
      summarizeApplianceRequests([
        { quantity: 2, applianceType: { name: "Washer" }, package: set },
        { quantity: 2, applianceType: { name: "Dryer" }, package: set },
        { quantity: 1, applianceType: { name: "Refrigerator" }, package: null },
      ]),
    ).toBe("2x Washer + Dryer Set, 1x Refrigerator");
    expect(summarizeApplianceRequests([{ quantity: 1, applianceType: { name: "Washer" } }], " × ")).toBe("1 × Washer");
    expect(summarizeApplianceRequests([])).toBe("");
  });
});
