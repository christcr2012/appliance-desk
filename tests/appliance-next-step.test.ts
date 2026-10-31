import { describe, expect, it } from "vitest";
import { applianceNextStep, type NextStepExtras } from "@/domains/inventory/next-step";

const NONE: NextStepExtras = {
  awayForRepair: false,
  custodyMissing: false,
  retiredPlanMissing: false,
  isOldSet: false,
};

const a = (status: string, tax = "SALES_TAX_PAID") => ({
  id: "unit-1",
  status: status as never,
  acquisitionTaxStatus: tax,
});

describe("applianceNextStep", () => {
  it("away for repair beats everything", () => {
    const step = applianceNextStep(a("AWAITING_INSPECTION", "UNKNOWN"), {
      ...NONE,
      awayForRepair: true,
      custodyMissing: true,
    });
    expect(step?.href).toBe("/desk/inventory/unit-1/out-of-service");
    expect(step?.tone).toBe("attention");
  });

  it("inspection, then cleaning, then missing custody", () => {
    expect(applianceNextStep(a("AWAITING_INSPECTION"), NONE)?.label).toBe("Inspect it");
    expect(applianceNextStep(a("CLEANING"), NONE)?.label).toBe("Finish cleaning it");
    expect(
      applianceNextStep(a("RENTED"), { ...NONE, custodyMissing: true })?.label,
    ).toBe("Record who has it");
  });

  it("undecided purchase tax points at the Tax tab", () => {
    const step = applianceNextStep(a("AVAILABLE", "UNKNOWN"), NONE);
    expect(step?.href).toBe("/desk/inventory/unit-1?tab=tax");
    expect(step?.tone).toBe("info");
  });

  it("retired without a plan asks for the plan; with a plan it is quiet", () => {
    expect(
      applianceNextStep(a("RETIRED"), { ...NONE, retiredPlanMissing: true })?.href,
    ).toBe("/desk/inventory/unit-1?tab=retired");
    expect(applianceNextStep(a("RETIRED"), NONE)).toBeNull();
  });

  it("an old set offers the split, after the tax question", () => {
    expect(applianceNextStep(a("AVAILABLE"), { ...NONE, isOldSet: true })?.href).toBe(
      "/desk/inventory/unit-1/split",
    );
    expect(
      applianceNextStep(a("AVAILABLE", "UNKNOWN"), { ...NONE, isOldSet: true })?.href,
    ).toBe("/desk/inventory/unit-1?tab=tax");
  });

  it("a settled available unit has no next step", () => {
    expect(applianceNextStep(a("AVAILABLE"), NONE)).toBeNull();
    expect(applianceNextStep(a("RENTED"), NONE)).toBeNull();
  });
});
