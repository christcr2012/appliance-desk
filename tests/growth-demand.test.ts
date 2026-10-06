import { describe, expect, it } from "vitest";
import { computeDemandEstimateRow } from "@/domains/growth/demand";

describe("growth demand estimate", () => {
  it("compares open lead demand with units not currently in customer custody", () => {
    expect(
      computeDemandEstimateRow({
        applianceTypeId: "washer",
        applianceTypeName: "Washer",
        fleetUnits: 8,
        unitsInCustomerCustody: 6,
        openLeadRequestedUnits: 5,
      }),
    ).toEqual({
      applianceTypeId: "washer",
      applianceTypeName: "Washer",
      fleetUnits: 8,
      unitsInCustomerCustody: 6,
      availableUnitsEstimate: 2,
      openLeadRequestedUnits: 5,
      estimatedUnitGap: 3,
    });
  });

  it("never reports negative availability or a negative estimated gap", () => {
    const row = computeDemandEstimateRow({
      applianceTypeId: "dryer",
      applianceTypeName: "Dryer",
      fleetUnits: 2,
      unitsInCustomerCustody: 3,
      openLeadRequestedUnits: 1,
    });
    expect(row.availableUnitsEstimate).toBe(0);
    expect(row.estimatedUnitGap).toBe(1);
  });
});
