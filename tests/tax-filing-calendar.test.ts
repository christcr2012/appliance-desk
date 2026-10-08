import { describe, expect, it } from "vitest";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  coloradoLegalHolidays,
  dueOnFor,
  legalDueOn,
  periodsFor,
  reminderStages,
} from "@/domains/tax/filing-calendar";

function day(value: string): Date {
  const date = businessDateFromKey(value);
  if (!date) throw new Error(`Invalid fixture date: ${value}`);
  return date;
}
const key = businessDateKey;
const dates = (ranges: ReturnType<typeof periodsFor>) =>
  ranges.map((period) => [key(period.start), key(period.end)]);

describe("Colorado filing periods", () => {
  it("clips the first month and spans later complete months", () => {
    expect(dates(periodsFor(
      { frequency: "MONTHLY", firstPeriodStart: day("2026-03-15") },
      day("2026-05-03"),
    ))).toEqual([
      ["2026-03-15", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
      ["2026-05-01", "2026-05-31"],
    ]);
  });

  it("clips the first quarter and preserves subsequent quarter boundaries", () => {
    expect(dates(periodsFor(
      { frequency: "QUARTERLY", firstPeriodStart: day("2026-02-11") },
      day("2026-07-01"),
    ))).toEqual([
      ["2026-02-11", "2026-03-31"],
      ["2026-04-01", "2026-06-30"],
      ["2026-07-01", "2026-09-30"],
    ]);
  });

  it("starts annually at the configured date without moving to January before it", () => {
    expect(dates(periodsFor(
      { frequency: "ANNUAL", firstPeriodStart: day("2026-12-15") },
      day("2027-01-02"),
    ))).toEqual([
      ["2026-12-15", "2026-12-31"],
      ["2027-01-01", "2027-12-31"],
    ]);
  });

  it("does not invent filing periods without a start or before the first date", () => {
    expect(periodsFor({ frequency: "MONTHLY", firstPeriodStart: null }, day("2026-10-01"))).toEqual([]);
    expect(periodsFor(
      { frequency: "MONTHLY", firstPeriodStart: day("2026-10-02") },
      day("2026-10-01"),
    )).toEqual([]);
  });

  it("resolves period boundaries at Denver midnight across both DST changes", () => {
    const march = periodsFor(
      { frequency: "MONTHLY", firstPeriodStart: day("2026-03-08") },
      day("2026-03-10"),
    );
    expect(march[0].start.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    const november = periodsFor(
      { frequency: "MONTHLY", firstPeriodStart: day("2026-11-01") },
      day("2026-11-03"),
    );
    expect(november[0].start.toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });
});

describe("filing due dates and Colorado statutory holidays", () => {
  it("uses the month after period end, crossing December and clamping short months", () => {
    expect(key(dueOnFor(day("2026-12-31"), 20))).toBe("2027-01-20");
    expect(key(dueOnFor(day("2027-01-31"), 31))).toBe("2027-02-28");
    expect(key(dueOnFor(day("2028-01-31"), 31))).toBe("2028-02-29");
    expect(() => dueOnFor(day("2026-12-31"), 0)).toThrow();
    expect(() => dueOnFor(day("2026-12-31"), 32)).toThrow();
    expect(() => dueOnFor(day("2026-12-31"), 1.5)).toThrow();
  });

  it.each([
    [2026, ["01-01","01-19","02-16","05-25","06-19","07-04","09-07","10-05","11-11","11-26","12-25"]],
    [2027, ["01-01","01-18","02-15","05-31","06-19","07-04","07-05","09-06","10-04","11-11","11-25","12-25"]],
    [2028, ["01-01","01-17","02-21","05-29","06-19","07-04","09-04","10-02","11-11","11-23","12-25"]],
    [2029, ["01-01","01-15","02-19","05-28","06-19","07-04","09-03","10-01","11-11","11-12","11-22","12-25"]],
    [2030, ["01-01","01-21","02-18","05-27","06-19","07-04","09-02","10-07","11-11","11-28","12-25"]],
  ])("returns every statutory holiday and Sunday observation in %i", (year, expected) => {
    expect(coloradoLegalHolidays(year).map(key)).toEqual(
      expected.map((suffix) => `${year}-${suffix}`),
    );
  });

  it("extends weekends, Sunday-observed Monday holidays and holidays followed by weekends", () => {
    expect(key(legalDueOn(day("2026-06-20")))).toBe("2026-06-22");
    expect(key(legalDueOn(day("2027-07-04")))).toBe("2027-07-06");
    expect(key(legalDueOn(day("2026-11-26")))).toBe("2026-11-27");
    expect(key(legalDueOn(day("2026-10-20")))).toBe("2026-10-20");
  });
});

describe("filing reminder lifecycle", () => {
  const account = { reminderDaysBefore: [7, 2, 7, 0, -1, 1.5] };
  const period = {
    periodEnd: day("2026-09-30"),
    dueOn: day("2026-10-20"),
    legalDueOn: day("2026-10-20"),
  };
  it("emits READY the day after the close, then de-duplicated advance reminders", () => {
    expect(reminderStages(period, account, day("2026-10-01"))).toEqual(["READY"]);
    expect(reminderStages(period, account, day("2026-10-13"))).toEqual(["DUE_IN_7"]);
    expect(reminderStages(period, account, day("2026-10-18"))).toEqual(["DUE_IN_2"]);
    expect(reminderStages(period, account, day("2026-10-14"))).toEqual([]);
  });

  it("does not label a return overdue until after the legal due date", () => {
    const holidayPeriod = {
      periodEnd: day("2026-05-31"),
      dueOn: day("2026-06-20"),
      legalDueOn: day("2026-06-22"),
    };
    expect(reminderStages(holidayPeriod, account, day("2026-06-20"))).toEqual(["DUE_TODAY"]);
    expect(reminderStages(holidayPeriod, account, day("2026-06-21"))).toEqual(["DUE_BY_LEGAL"]);
    expect(reminderStages(holidayPeriod, account, day("2026-06-22"))).toEqual(["DUE_BY_LEGAL"]);
    expect(reminderStages(holidayPeriod, account, day("2026-06-23"))).toEqual(["OVERDUE"]);
    expect(reminderStages(period, account, day("2026-10-20"))).toEqual(["DUE_TODAY"]);
    expect(reminderStages(period, account, day("2026-10-21"))).toEqual(["OVERDUE"]);
  });
});
