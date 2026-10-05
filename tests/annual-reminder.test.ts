import { describe, expect, it } from "vitest";
import { composeAnnualReminder, nextAnnualBoundary } from "@/domains/notices/annual-reminder";
import { composeTermsChangeNotice } from "@/domains/notices/terms-change";
import { fillWording, unknownPlaceholders } from "@/domains/notices/wording";
import { parseMonthToMonthSettings } from "@/domains/settings/month-to-month";

describe("yearly boundary", () => {
  it("is the next twelve-month anniversary after now, counted from the first delivery", () => {
    const since = new Date("2027-02-08T07:00:00Z");
    expect(nextAnnualBoundary(since, new Date("2027-12-28T18:00:00Z"))).toEqual({ k: 1, boundary: new Date("2028-02-08T07:00:00Z") });
    expect(nextAnnualBoundary(since, new Date("2028-02-08T07:00:01Z")).k).toBe(2);
  });
});

describe("notice wording", () => {
  it("fills the starting drafts and the owner's own wording", () => {
    const reminder = composeAnnualReminder({
      customerName: "Pat",
      boundary: new Date("2028-02-08T07:00:00Z"),
      monthlyTotalCents: 3000,
      lineLabels: ["Washer"],
      noticeDays: 30,
      businessName: "Robinson",
      businessPhone: "555",
      businessEmail: "a@b.c",
    });
    expect(reminder.body).toContain("Hello Pat");
    expect(reminder.body).toContain("$30 a month");
    expect(reminder.body).not.toMatch(/\{\w+\}/);
    const change = composeTermsChangeNotice({
      customerName: "Pat",
      noticeDays: 45,
      termsText: " New terms ",
      changeDays: 30,
      businessName: "Robinson",
      businessPhone: "555",
      businessEmail: "a@b.c",
      template: "Hi {customerName}: {noticeDays} days. {termsText}",
    });
    expect(change.body).toBe("Hi Pat: 45 days. New terms");
  });

  it("catches a misspelled placeholder before it reaches a customer", () => {
    expect(unknownPlaceholders("Hi {customerNam} and {noticeDays}")).toEqual(["{customerNam}"]);
    expect(fillWording("{a}", {})).toBe("{a}");
    const parsed = parseMonthToMonthSettings({ monthToMonthChangeNoticeDays: "30", termsChangeNoticeText: "Hi {nope}", annualReminderText: "" });
    expect(parsed.success).toBe(false);
  });

  it("keeps the change days between 30 and 90", () => {
    const base = { termsChangeNoticeText: "", annualReminderText: "" };
    expect(parseMonthToMonthSettings({ ...base, monthToMonthChangeNoticeDays: "29" }).success).toBe(false);
    expect(parseMonthToMonthSettings({ ...base, monthToMonthChangeNoticeDays: "91" }).success).toBe(false);
    expect(parseMonthToMonthSettings({ ...base, monthToMonthChangeNoticeDays: "90" }).success).toBe(true);
  });
});
