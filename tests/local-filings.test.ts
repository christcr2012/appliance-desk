import { describe, expect, it } from "vitest";
import { obligationByKey, type ComplianceContext } from "@/domains/compliance/registry";
import {
  greeleyPeriods,
  usdotPeriods,
  usdotSchedule,
  usdotScheduleWords,
  vehiclePeriods,
} from "@/domains/compliance/local-schedules";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

// CMP-4: the local-filing schedules. Every date derives from a recorded
// fact — the USDOT number's last two digits, the Greeley license date,
// the truck's registration month — and no fact means no dates.

const day = (s: string) => businessDateFromKey(s)!;
const key = (d: Date) => businessDateKey(d);

const base: ComplianceContext = {
  entityType: "SINGLE_MEMBER_LLC",
  employees: 0,
  truckGvwrLbs: 20000,
  sosReportMonth: null,
  hasHomeOffice: false,
  hasEin: true,
  hasDepreciableAssets: false,
  hasAssetSales: false,
  tradeName: null,
  usdotNumber: null,
  truckRegistrationMonth: null,
  greeleyLicenseDate: null,
};
const ctx = (patch: Partial<ComplianceContext>): ComplianceContext => ({ ...base, ...patch });

describe("USDOT biennial schedule (FMCSA digit rule)", () => {
  it("reads the month off the last digit and the parity off the next-to-last", () => {
    expect(usdotSchedule("1234576")).toEqual({ month: 6, parity: "odd" }); // ...7 = odd years, 6 = June
    expect(usdotSchedule("1234500")).toEqual({ month: 10, parity: "even" }); // ...0 = even years, 0 = October
    expect(usdotSchedule("9999991")).toEqual({ month: 1, parity: "odd" }); // ...9 odd, 1 = January
    expect(usdotSchedule("USDOT 1234576")).toEqual({ month: 6, parity: "odd" }); // non-digits are ignored
  });

  it("refuses a number that is missing or too short to read", () => {
    expect(usdotSchedule(null)).toBeNull();
    expect(usdotSchedule("")).toBeNull();
    expect(usdotSchedule("7")).toBeNull();
    expect(usdotScheduleWords(null)).toBeNull();
    expect(usdotScheduleWords("1234576")).toMatch(/June of odd years/);
  });

  it("schedules the update only in the parity year, due the last day of its month", () => {
    const odd = usdotPeriods(2027, "1234576");
    expect(odd).toHaveLength(1);
    expect(key(odd[0].dueOn)).toBe("2027-06-30");
    expect(key(odd[0].opens)).toBe("2027-04-01");
    expect(odd[0].periodKey).toBe("2027");
    expect(usdotPeriods(2028, "1234576")).toEqual([]);
    const even = usdotPeriods(2028, "1234500");
    expect(even).toHaveLength(1);
    expect(key(even[0].dueOn)).toBe("2028-10-31");
    expect(usdotPeriods(2027, "1234500")).toEqual([]);
    expect(usdotPeriods(2027, null)).toEqual([]);
  });

  it("the registry obligation stays unscheduled until the number is recorded", () => {
    const usdot = obligationByKey("fed.usdot")!;
    expect(usdot.applies(base).applies).toBe(true); // 20,000 lb truck
    expect(usdot.periods(2027, base)).toEqual([]);
    expect(usdot.unscheduledReason).toMatch(/Record the number in Business facts/);
    const withNumber = ctx({ usdotNumber: "1234576" });
    expect(usdot.periods(2027, withNumber).map((p) => key(p.dueOn))).toEqual(["2027-06-30"]);
    expect(usdot.applies(ctx({ truckGvwrLbs: 14000 })).applies).toBe(false);
  });
});

describe("Greeley license biennial periods", () => {
  it("renews every two years on the license date, opening 60 days ahead", () => {
    const license = day("2025-06-15");
    expect(greeleyPeriods(2025, license)).toEqual([]); // the license year itself is not a renewal
    expect(greeleyPeriods(2026, license)).toEqual([]);
    const renewal = greeleyPeriods(2027, license);
    expect(renewal).toHaveLength(1);
    expect(key(renewal[0].dueOn)).toBe("2027-06-15");
    expect(key(renewal[0].opens)).toBe("2027-04-16"); // 60 days before
    expect(greeleyPeriods(2029, license).map((p) => key(p.dueOn))).toEqual(["2029-06-15"]);
  });

  it("clamps a February 29 license date to February 28 in plain years", () => {
    const renewal = greeleyPeriods(2026, day("2024-02-29"));
    expect(renewal).toHaveLength(1);
    expect(key(renewal[0].dueOn)).toBe("2026-02-28");
  });

  it("no license date, no periods — through the registry too", () => {
    expect(greeleyPeriods(2027, null)).toEqual([]);
    const greeley = obligationByKey("greeley.business_license")!;
    expect(greeley.periods(2027, base)).toEqual([]);
    expect(
      greeley.periods(2027, ctx({ greeleyLicenseDate: day("2025-06-15") })).map((p) => key(p.dueOn)),
    ).toEqual(["2027-06-15"]);
  });
});

describe("truck registration periods", () => {
  it("falls in the registration month, open from the month before", () => {
    const march = vehiclePeriods(2027, 3);
    expect(march).toHaveLength(1);
    expect(key(march[0].opens)).toBe("2027-02-01");
    expect(key(march[0].dueOn)).toBe("2027-03-31");
    const january = vehiclePeriods(2027, 1);
    expect(key(january[0].opens)).toBe("2026-12-01");
    expect(key(january[0].dueOn)).toBe("2027-01-31");
    expect(vehiclePeriods(2027, null)).toEqual([]);
    expect(vehiclePeriods(2027, 13)).toEqual([]);
  });
});

describe("trade name (confirmed rule: an LLC never renews)", () => {
  it("asks for the fact while unrecorded and steps aside once recorded", () => {
    const tradeName = obligationByKey("co.sos.trade_name")!;
    const unrecorded = tradeName.applies(base);
    expect(unrecorded.applies).toBe(true);
    expect(tradeName.periods(2027, base)).toEqual([]);
    const recorded = tradeName.applies(ctx({ tradeName: "Robinson Rentals" }));
    expect(recorded.applies).toBe(false);
    expect(recorded.why).toMatch(/never asks an LLC to renew it/);
    expect(recorded.why).toContain("Robinson Rentals");
  });
});
