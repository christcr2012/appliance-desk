import { describe, expect, it } from "vitest";
import { businessDateKey } from "@/lib/business-date";
import { evidenceDateFor, noticeWindowState, windowForRenewalStart } from "@/domains/notices/state";

describe("windowForRenewalStart", () => {
  it("runs from Colorado midnight 40 days before to the last second of the day 25 days before", () => {
    const w = windowForRenewalStart(new Date("2027-11-08T07:00:00Z"));
    expect(w.earliestAt.toISOString()).toBe("2027-09-29T06:00:00.000Z");
    expect(w.deadlineAt.toISOString()).toBe("2027-10-15T05:59:59.000Z");
  });

  it("is correct across the November daylight-saving change (renewal starts the Monday after clocks fall back)", () => {
    const w = windowForRenewalStart(new Date("2027-11-08T07:00:00Z"));
    expect(businessDateKey(w.earliestAt)).toBe("2027-09-29");
    expect(businessDateKey(w.deadlineAt)).toBe("2027-10-14");
  });

  it("is correct across the March change (renewal starts after clocks spring forward)", () => {
    // Renewal starts 2027-03-15 00:00 MDT; 40 days earlier is 2027-02-03 (MST), 25 days earlier is 2027-02-18 (MST).
    const w = windowForRenewalStart(new Date("2027-03-15T06:00:00Z"));
    expect(w.earliestAt.toISOString()).toBe("2027-02-03T07:00:00.000Z");
    expect(businessDateKey(w.deadlineAt)).toBe("2027-02-18");
    expect(w.deadlineAt.toISOString()).toBe("2027-02-19T06:59:59.000Z");
  });
});

describe("noticeWindowState at 41/40/25/24 days before a renewal", () => {
  const start = new Date("2027-11-08T07:00:00Z");
  const w = windowForRenewalStart(start);
  const daysBefore = (n: number) => new Date(start.getTime() - n * 86_400_000 + 12 * 3_600_000);
  it("gives TOO_EARLY, OPEN, OPEN, PAST_DEADLINE", () => {
    expect(noticeWindowState(w, daysBefore(41))).toBe("TOO_EARLY");
    expect(noticeWindowState(w, daysBefore(40))).toBe("OPEN");
    expect(noticeWindowState(w, daysBefore(25))).toBe("OPEN");
    expect(noticeWindowState(w, daysBefore(24))).toBe("PAST_DEADLINE");
  });
  it("a notice with no window is always open", () => {
    expect(noticeWindowState({ earliestAt: null, deadlineAt: null }, new Date())).toBe("OPEN");
  });
});

describe("evidenceDateFor", () => {
  const date = new Date("2027-10-01T06:00:00Z");
  it("adds the mail-transit days for mail only", () => {
    expect(businessDateKey(evidenceDateFor({ channel: "MAIL", date, mailTransitDays: 3 }))).toBe("2027-10-04");
    expect(evidenceDateFor({ channel: "IN_PERSON_WRITTEN", date, mailTransitDays: 3 })).toBe(date);
    expect(evidenceDateFor({ channel: "BUSINESS_MAILBOX", date, mailTransitDays: 3 })).toBe(date);
  });
});
