import { describe, expect, it } from "vitest";
import { addBankingDays, bankingDaysBetween } from "@/lib/business-date";

// Midday Colorado times, so the Colorado date is the date written (MDT = UTC-6, MST = UTC-7).
const noon = (key: string) => new Date(`${key}T18:30:00Z`);

describe("bankingDaysBetween (BILL-1)", () => {
  it("counts a payment started Friday as 4 banking days old on Thursday (not 6 calendar days)", () => {
    expect(bankingDaysBetween(noon("2026-10-23"), noon("2026-10-29"))).toBe(4);
  });

  it("is 0 on the same Colorado day and never counts weekends", () => {
    expect(bankingDaysBetween(noon("2026-10-23"), noon("2026-10-23"))).toBe(0);
    expect(bankingDaysBetween(noon("2026-10-23"), noon("2026-10-25"))).toBe(0); // Friday → Sunday
    expect(bankingDaysBetween(noon("2026-10-24"), noon("2026-10-26"))).toBe(1); // Saturday → Monday
  });

  it("is negative when the second date is earlier", () => {
    expect(bankingDaysBetween(noon("2026-10-29"), noon("2026-10-23"))).toBe(-4);
  });

  it("skips Thanksgiving in Thanksgiving week", () => {
    // Monday Nov 23 → Friday Nov 27, 2026: Tue, Wed, (Thu is Thanksgiving), Fri = 3.
    expect(bankingDaysBetween(noon("2026-11-23"), noon("2026-11-27"))).toBe(3);
  });

  it("observes a Sunday holiday on Monday", () => {
    // New Year's Day 2023 was a Sunday, so Monday Jan 2 is the holiday: Fri Dec 30 → Tue Jan 3 = 1.
    expect(bankingDaysBetween(noon("2022-12-30"), noon("2023-01-03"))).toBe(1);
    // Juneteenth 2022 was a Sunday, observed Monday Jun 20: Fri Jun 17 → Tue Jun 21 = 1.
    expect(bankingDaysBetween(noon("2022-06-17"), noon("2022-06-21"))).toBe(1);
  });

  it("does not move a Saturday holiday (Federal Reserve practice)", () => {
    // July 4, 2026 is a Saturday: Friday July 3 is still a banking day. Thu Jul 2 → Mon Jul 6 = Fri + Mon = 2.
    expect(bankingDaysBetween(noon("2026-07-02"), noon("2026-07-06"))).toBe(2);
  });

  it("skips every other Federal Reserve holiday (2026 dates)", () => {
    const holidays = ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"];
    for (const day of holidays) {
      const before = new Date(`${day}T18:30:00Z`);
      before.setUTCDate(before.getUTCDate() - 1);
      const after = new Date(`${day}T18:30:00Z`);
      after.setUTCDate(after.getUTCDate() + 1);
      const weekday = new Date(`${day}T18:30:00Z`).getUTCDay();
      // Tuesday to Thursday holidays only (no weekend between the day before and the day after): the holiday itself is skipped.
      if (weekday >= 2 && weekday <= 4) {
        expect(bankingDaysBetween(before, after), day).toBe(1);
      }
      // A Monday or Friday holiday: the holiday is not a banking day, so counting from the Sunday/Saturday before it reaches
      // the next banking day only after the holiday.
      if (weekday === 1) expect(bankingDaysBetween(new Date(`${day}T18:30:00Z`), after), day).toBe(1);
    }
  });

  it("uses the Colorado date, not the UTC date, near midnight", () => {
    // 5 pm Colorado on Friday Oct 23 is already Saturday in UTC.
    expect(bankingDaysBetween(new Date("2026-10-24T01:00:00Z"), noon("2026-10-26"))).toBe(1);
  });
});

describe("addBankingDays (BILL-1)", () => {
  it("returns Colorado midnight of the banking day", () => {
    expect(addBankingDays(noon("2026-10-23"), 4).toISOString()).toBe("2026-10-29T06:00:00.000Z");
  });

  it("crosses the November clock change and the weekend", () => {
    // Fri Oct 30 + 1 banking day = Mon Nov 2 midnight in standard time (UTC-7).
    expect(addBankingDays(noon("2026-10-30"), 1).toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });

  it("skips Thanksgiving and counts backwards", () => {
    expect(addBankingDays(noon("2026-11-25"), 1).toISOString()).toBe("2026-11-27T07:00:00.000Z");
    expect(addBankingDays(noon("2026-11-27"), -1).toISOString()).toBe("2026-11-25T07:00:00.000Z");
  });

  it("round-trips with bankingDaysBetween", () => {
    const start = noon("2026-12-23");
    for (let n = 0; n <= 12; n += 1) {
      expect(bankingDaysBetween(start, addBankingDays(start, n))).toBe(n);
    }
  });
});
