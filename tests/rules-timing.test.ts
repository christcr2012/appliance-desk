import { describe, expect, it } from "vitest";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { fileAndPayOnDate, subtractWorkingDays, whenToAct } from "@/domains/rules/timing";

const day = (key: string) => businessDateFromKey(key)!;
const key = (date: Date) => businessDateKey(date);

describe("whenToAct", () => {
  it("costs: 90% through Oct 31 → Nov 20, at least 3 business days before the deadline", () => {
    // 90% of the 20-day window lands Nov 18; 3 working days back from Fri Nov 20 is Tue Nov 17.
    const { actOn, reason } = whenToAct({
      opens: day("2026-10-31"), closes: day("2026-11-20"), effect: "COSTS",
      now: day("2026-10-31"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-11-17");
    expect(reason).toContain("90%");
  });

  it("costs: a margin larger than the window acts on the opening day", () => {
    const { actOn } = whenToAct({
      opens: day("2026-11-18"), closes: day("2026-11-20"), effect: "COSTS",
      now: day("2026-11-18"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-11-18");
  });

  it("costs: today past the point acts today, never after the deadline", () => {
    const { actOn } = whenToAct({
      opens: day("2026-10-31"), closes: day("2026-11-20"), effect: "COSTS",
      now: day("2026-11-19"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-11-19");
    const late = whenToAct({
      opens: day("2026-10-31"), closes: day("2026-11-20"), effect: "COSTS",
      now: day("2026-11-25"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(late.actOn)).toBe("2026-11-20");
  });

  it("costs: the spring clock change inside the window moves nothing", () => {
    // Mar 8, 2026 springs forward; calendar-day math on business dates is unaffected.
    const { actOn } = whenToAct({
      opens: day("2026-03-06"), closes: day("2026-03-20"), effect: "COSTS",
      now: day("2026-03-06"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-03-17");
  });

  it("costs: the autumn clock change inside the window moves nothing", () => {
    // Nov 1, 2026 falls back; the 90% point and margin land the same days.
    const { actOn } = whenToAct({
      opens: day("2026-10-30"), closes: day("2026-11-10"), effect: "COSTS",
      now: day("2026-10-30"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-11-05");
  });

  it("fixed: acts on the fixed date exactly", () => {
    const { actOn } = whenToAct({
      opens: day("2026-06-01"), closes: day("2026-07-31"), effect: "FIXED",
      fixedOn: day("2026-07-01"), now: day("2026-06-01"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-07-01");
  });

  it("benefits: acts when the window opens, or today once it has opened", () => {
    const before = whenToAct({
      opens: day("2026-01-01"), closes: day("2026-01-31"), effect: "BENEFITS",
      now: day("2025-12-15"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(before.actOn)).toBe("2026-01-01");
    const after = whenToAct({
      opens: day("2026-01-01"), closes: day("2026-01-31"), effect: "BENEFITS",
      now: day("2026-01-20"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(after.actOn)).toBe("2026-01-20");
  });

  it("rejects a percent outside 85–95 and a margin outside 1–10", () => {
    const base = {
      opens: day("2026-10-31"), closes: day("2026-11-20"), effect: "COSTS" as const,
      now: day("2026-10-31"), percent: 90, marginBusinessDays: 3,
    };
    expect(() => whenToAct({ ...base, percent: 80 })).toThrow("85");
    expect(() => whenToAct({ ...base, marginBusinessDays: 0 })).toThrow("1");
    expect(() => whenToAct({ ...base, marginBusinessDays: 11 })).toThrow("10");
  });
});

describe("subtractWorkingDays", () => {
  it("skips weekends", () => {
    // Fri Nov 20 → Thu 19 (1), Wed 18 (2), Tue 17 (3).
    expect(subtractWorkingDays("2026-11-20", 3)).toBe("2026-11-17");
    // Mon Nov 30 → Fri 27 (1), skipping the weekend.
    expect(subtractWorkingDays("2026-11-30", 1)).toBe("2026-11-27");
  });

  it("skips Colorado legal holidays", () => {
    // Thu Nov 26, 2026 is Thanksgiving: 3 working days back from Mon Nov 30
    // is Fri 27 (1), Wed 25 (2), Tue 24 (3).
    expect(subtractWorkingDays("2026-11-30", 3)).toBe("2026-11-24");
  });
});

describe("fileAndPayOnDate", () => {
  it("opens the day after the period ends and closes on the legal due date", () => {
    // October period ends Oct 31 (Sat); due Nov 20 (Fri). Same answer as the window test.
    const actOn = fileAndPayOnDate({
      periodEnd: day("2026-10-31"), legalDueOn: day("2026-11-20"),
      now: day("2026-10-31"), percent: 90, marginBusinessDays: 3,
    });
    expect(key(actOn)).toBe("2026-11-17");
  });
});
