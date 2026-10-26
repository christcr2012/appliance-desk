import { describe, expect, it } from "vitest";
import { baseFeeDateKey, decideLateFee, type LateFeeFacts } from "@/domains/billing/late-fee-rules";
import { businessDateKey } from "@/lib/business-date";

// DEC-2: the day-11 rule pinned with real Denver dates, including the day the clocks go back (1 Nov 2026).
const facts = (over: Partial<LateFeeFacts>): LateFeeFacts => ({
  todayKey: "2026-10-01", dueKey: "2026-10-01", graceDays: 10, noticeDays: 2, warnedKey: "2026-09-20",
  failedPaymentAfterWarning: false, outstandingCents: 10_000, feeCents: 500, militaryHold: false,
  agreementNamesFee: true, paymentInProgress: false, alreadyCharged: false, ...over,
});

describe("late fee on day 11", () => {
  it("due Oct 1: no fee through Oct 11, the fee on Oct 12 (the 11th day late)", () => {
    for (const day of ["2026-10-02", "2026-10-10", "2026-10-11"]) {
      expect(decideLateFee(facts({ todayKey: day })).kind).not.toBe("RECORD_FEE");
    }
    expect(decideLateFee(facts({ todayKey: "2026-10-12" }))).toEqual({ kind: "RECORD_FEE", feeCents: 500 });
  });

  it("a shorter grace in an old agreement still waits for day 11", () => {
    expect(baseFeeDateKey("2026-10-01", 5)).toBe("2026-10-12");
    expect(baseFeeDateKey("2026-10-01", 0)).toBe("2026-10-12");
  });

  it("across the clocks going back: due Oct 28, the fee starts at midnight Denver time on Nov 8, not an hour earlier or later", () => {
    // Clocks go back at 2 am on Sunday 1 Nov 2026, so Denver is UTC-7 afterwards.
    const beforeMidnight = new Date("2026-11-08T06:59:00Z"); // 11:59 pm Denver on Nov 7
    const afterMidnight = new Date("2026-11-08T07:00:00Z"); // 12:00 am Denver on Nov 8
    expect(businessDateKey(beforeMidnight)).toBe("2026-11-07");
    expect(businessDateKey(afterMidnight)).toBe("2026-11-08");
    const base = { dueKey: "2026-10-28", warnedKey: "2026-10-30" };
    expect(decideLateFee(facts({ ...base, todayKey: businessDateKey(beforeMidnight) })).kind).toBe("WAIT");
    expect(decideLateFee(facts({ ...base, todayKey: businessDateKey(afterMidnight) })))
      .toEqual({ kind: "RECORD_FEE", feeCents: 500 });
  });

  it("across the clocks going forward: due Mar 1 2027, the fee starts Mar 12 (clocks change Mar 14)", () => {
    expect(baseFeeDateKey("2027-03-01", 10)).toBe("2027-03-12");
    const spring = new Date("2027-03-14T09:30:00Z"); // 2:30 am MST does not exist; this instant is 3:30 am MDT
    expect(businessDateKey(spring)).toBe("2027-03-14");
  });
});
