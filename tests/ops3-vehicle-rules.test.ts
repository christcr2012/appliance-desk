import { describe, expect, it } from "vitest";
import {
  checkVehicleInput, maskVin, mileageDeductionCents, purposeFromJobTypes, tripMiles, vehicleDueItems, vehicleRulesFor, ROUTE_PURPOSE_FALLBACK,
} from "@/domains/vehicle/rules";

const base = { nickname: "White van", year: 2021, make: "Ford", model: "Transit", gvwrLbs: 9500, odometerAtPurchase: 12000 };
const day = (key: string) => new Date(`${key}T12:00:00Z`);

describe("weight rules", () => {
  it("draws the lines exactly at 16,001 and 26,001 pounds", () => {
    expect(vehicleRulesFor(16_000, true).level).toBe("NONE");
    expect(vehicleRulesFor(16_001, true).level).toBe("COLORADO_COMMERCIAL");
    expect(vehicleRulesFor(26_000, true).level).toBe("COLORADO_COMMERCIAL");
    expect(vehicleRulesFor(26_001, true).level).toBe("CDL");
    expect(vehicleRulesFor(9_500, true).headline).toBe("No special license");
  });
  it("only asks for a medical card in the middle band when the owner setting says so", () => {
    expect(vehicleRulesFor(20_000, true).points.join(" ")).toMatch(/medical card is asked for/);
    expect(vehicleRulesFor(20_000, false).points.join(" ")).toMatch(/chose not to require/);
  });
});

describe("vehicle input", () => {
  it("accepts a normal van", () => expect(checkVehicleInput(base, 2026)).toBeNull());
  it("requires the weight rating, in plain words", () => {
    expect(checkVehicleInput({ ...base, gvwrLbs: 0 }, 2026)).toMatch(/GVWR/);
    expect(checkVehicleInput({ ...base, gvwrLbs: Number.NaN }, 2026)).toMatch(/GVWR/);
  });
  it("refuses odd values", () => {
    expect(checkVehicleInput({ ...base, nickname: " " }, 2026)).toMatch(/short name/);
    expect(checkVehicleInput({ ...base, year: 1900 }, 2026)).toMatch(/year/);
    expect(checkVehicleInput({ ...base, vin: "OOO" }, 2026)).toMatch(/VIN/);
    expect(checkVehicleInput({ ...base, registrationMonth: 13 }, 2026)).toMatch(/month/);
    expect(checkVehicleInput({ ...base, odometerAtPurchase: -1 }, 2026)).toMatch(/odometer/);
  });
  it("hides all but the last four characters of a VIN", () => {
    expect(maskVin("1FTBW2CM5MKA12345")).toBe("••••2345");
    expect(maskVin(null)).toBe("");
  });
});

describe("trips and the deduction", () => {
  it("works out miles and refuses impossible readings", () => {
    expect(tripMiles(1000, 1042)).toBe(42);
    expect(() => tripMiles(1000, 999)).toThrow(/lower/);
    expect(() => tripMiles(1000, 4000)).toThrow(/2,000/);
    expect(() => tripMiles(1000.5, 1010)).toThrow();
  });
  it("fills the purpose from the day's visit types", () => {
    expect(purposeFromJobTypes(["DELIVERY", "REMOVAL"])).toBe("Deliveries and pickups");
    expect(purposeFromJobTypes(["DELIVERY", "MAINTENANCE_VISIT"])).toBe("Deliveries and pickups and Service visits");
    expect(purposeFromJobTypes([])).toBe(ROUTE_PURPOSE_FALLBACK);
  });
  it("multiplies miles by the 2026 rate (72.5 cents) in whole cents", () => {
    expect(mileageDeductionCents(1000, 725)).toBe(72_500);
    expect(mileageDeductionCents(1, 725)).toBe(73); // 72.5 cents rounds up
    expect(mileageDeductionCents(0, 725)).toBe(0);
    expect(() => mileageDeductionCents(-1, 725)).toThrow();
  });
});

describe("reminders", () => {
  const v = { registrationMonth: 11, maintenanceEveryMiles: 5000, maintenanceEveryMonths: null, lastMaintenanceOn: null, lastMaintenanceMiles: 10000, medicalCardExpiresOn: null, gvwrLbs: 9500, odometerAtPurchase: 8000 };
  it("reminds about registration this month and the month before", () => {
    expect(vehicleDueItems(v, 11000, day("2026-11-05"), true, 11).some((d) => d.key === "REGISTRATION")).toBe(true);
    expect(vehicleDueItems(v, 11000, day("2026-10-20"), true, 10).some((d) => d.key === "REGISTRATION")).toBe(true);
    expect(vehicleDueItems(v, 11000, day("2026-08-20"), true, 8).some((d) => d.key === "REGISTRATION")).toBe(false);
    expect(vehicleDueItems({ ...v, registrationMonth: 1 }, 11000, day("2026-12-20"), true, 12).some((d) => d.key === "REGISTRATION")).toBe(true); // December → January
  });
  it("reminds about maintenance by miles since the last service", () => {
    expect(vehicleDueItems(v, 14999, day("2026-08-01"), true, 8).some((d) => d.key === "MAINTENANCE")).toBe(false);
    expect(vehicleDueItems(v, 15000, day("2026-08-01"), true, 8).some((d) => d.key === "MAINTENANCE")).toBe(true);
  });
  it("reminds about maintenance by months", () => {
    const m = { ...v, maintenanceEveryMiles: null, maintenanceEveryMonths: 6, lastMaintenanceOn: day("2026-01-01") };
    expect(vehicleDueItems(m, null, day("2026-06-01"), true, 6).some((d) => d.key === "MAINTENANCE")).toBe(false);
    expect(vehicleDueItems(m, null, day("2026-07-15"), true, 7).some((d) => d.key === "MAINTENANCE")).toBe(true);
  });
  it("asks for, and watches, the medical card only on heavier vehicles and when the setting is on", () => {
    const heavy = { ...v, registrationMonth: null, maintenanceEveryMiles: null, gvwrLbs: 20_000 };
    expect(vehicleDueItems(heavy, null, day("2026-06-01"), true, 6).map((d) => d.key)).toEqual(["MEDICAL_CARD"]);
    expect(vehicleDueItems(heavy, null, day("2026-06-01"), false, 6)).toEqual([]);
    expect(vehicleDueItems({ ...heavy, gvwrLbs: 9500 }, null, day("2026-06-01"), true, 6)).toEqual([]);
    expect(vehicleDueItems({ ...heavy, medicalCardExpiresOn: day("2026-07-15") }, null, day("2026-06-01"), true, 6)[0]?.label).toMatch(/expires soon/);
    expect(vehicleDueItems({ ...heavy, medicalCardExpiresOn: day("2026-05-01") }, null, day("2026-06-01"), true, 6)[0]?.overdue).toBe(true);
    expect(vehicleDueItems({ ...heavy, medicalCardExpiresOn: day("2027-05-01") }, null, day("2026-06-01"), true, 6)).toEqual([]);
  });
});
