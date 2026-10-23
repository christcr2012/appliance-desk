import { describe, expect, it } from "vitest";
import {
  addMonthsToDateKey,
  maskReference,
  nextDueAfterRenewal,
  reminderState,
} from "@/domains/paperwork/rules";
import { PAPERWORK_TEMPLATES } from "@/domains/paperwork/templates";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { paperworkInputSchema } from "@/domains/paperwork/schema";

const day = (key: string) => businessDateFromKey(key)!;
const noon = (key: string) => new Date(`${key}T18:00:00Z`);

describe("business paperwork rules", () => {
  it("adds months and keeps month ends sensible", () => {
    expect(addMonthsToDateKey("2026-03-15", 12)).toBe("2027-03-15");
    expect(addMonthsToDateKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateKey("2027-12-31", 2)).toBe("2028-02-29");
    expect(addMonthsToDateKey("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("reminds only inside the window, and when overdue", () => {
    const item = { status: "DONE" as const, dueOn: day("2026-12-01"), remindDaysBefore: 30 };
    expect(reminderState(item, noon("2026-10-01")).kind).toBe("upcoming");
    expect(reminderState(item, noon("2026-11-05"))).toEqual({ kind: "due_soon", daysLeft: 26 });
    expect(reminderState(item, noon("2026-12-01"))).toEqual({ kind: "due_soon", daysLeft: 0 });
    expect(reminderState(item, noon("2026-12-04"))).toEqual({ kind: "overdue", daysOver: 3 });
  });

  it("never reminds about items marked not needed or without a date", () => {
    expect(reminderState({ status: "NOT_NEEDED", dueOn: day("2026-01-01"), remindDaysBefore: 30 }, noon("2026-10-01")).kind).toBe("none");
    expect(reminderState({ status: "TO_DO", dueOn: null, remindDaysBefore: 30 }, noon("2026-10-01")).kind).toBe("none");
  });

  it("moves a renewed item to the next future date", () => {
    const next = nextDueAfterRenewal(day("2026-11-01"), 12, noon("2026-10-20"));
    expect(businessDateKey(next)).toBe("2027-11-01");
    // A long-overdue item jumps forward to a date that is still ahead.
    const late = nextDueAfterRenewal(day("2024-03-10"), 12, noon("2026-10-20"));
    expect(businessDateKey(late)).toBe("2027-03-10");
  });

  it("shows only the last four characters of a number", () => {
    expect(maskReference("12-3456789")).toBe("••••6789");
    expect(maskReference("1234")).toBe("••••");
    expect(maskReference(null)).toBe("");
  });

  it("starter checklist has unique keys, plain titles, https links and no invented fees or dates", () => {
    const keys = PAPERWORK_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of PAPERWORK_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(3);
      if (t.officialUrl) expect(t.officialUrl.startsWith("https://")).toBe(true);
      expect(t.whatItIs).not.toMatch(/\$\d/);
    }
  });

  it("validates the form: dates, https website, repeat length", () => {
    const base = { title: "Permit", groupName: "Other", status: "TO_DO", remindDaysBefore: "30", repeatEveryMonths: "" };
    expect(paperworkInputSchema.safeParse(base).success).toBe(true);
    expect(paperworkInputSchema.safeParse({ ...base, dueOn: "next spring" }).success).toBe(false);
    expect(paperworkInputSchema.safeParse({ ...base, officialUrl: "http://example.com" }).success).toBe(false);
    expect(paperworkInputSchema.safeParse({ ...base, repeatEveryMonths: "0" }).success).toBe(false);
    const ok = paperworkInputSchema.parse({ ...base, repeatEveryMonths: "12", dueOn: "2027-01-05", referenceNumber: "" });
    expect(ok.repeatEveryMonths).toBe(12);
    expect(ok.referenceNumber).toBeNull();
  });
});
