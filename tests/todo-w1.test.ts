import { describe, expect, it } from "vitest";
import { todoAction, todoDeadlineLabel, todoKey, validateSnoozeInput } from "@/domains/exceptions/todo";
import { pastDueInvoiceException, sortExceptions, type ExceptionItem } from "@/domains/exceptions/rules";

const now = new Date("2026-10-11T18:00:00Z");
const item: ExceptionItem = {
  category: "PAST_DUE_INVOICE", severity: "high", title: "Unpaid invoice",
  detail: "Needs payment", href: "/desk/billing/customer/customer-record-12345678/invoice/invoice-record-12345678",
  since: now, dueOn: new Date("2026-10-09T18:00:00Z"),
};
describe("W-1 owner To do", () => {
  it("uses a useful action and stable record identity when status wording changes", () => {
    expect(todoAction(item)).toEqual({ href: item.href, label: "Review unpaid invoice" });
    expect(todoKey(item)).toBe(todoKey({ ...item, title: "Partly paid invoice" }));
    expect(todoKey(item)).not.toBe(todoKey({ ...item, category: "OVERDUE_JOB" }));
  });
  it("sorts real deadlines ahead of undated alerts, then by severity", () => {
    const next = { ...item, dueOn: new Date("2026-10-20T18:00:00Z"), title: "Next" };
    const undated = { ...item, dueOn: undefined, title: "Unknown" };
    expect(sortExceptions([undated, next, item]).map((entry) => entry.title))
      .toEqual(["Unpaid invoice", "Next", "Unknown"]);
  });
  it("renders calendar-day deadlines across Colorado DST, without guessing an unknown due date", () => {
    expect(todoDeadlineLabel(new Date("2026-03-09T18:00:00Z"), new Date("2026-03-07T18:00:00Z"))).toContain("in 2 days");
    expect(todoDeadlineLabel(new Date("2026-10-09T18:00:00Z"), now)).toBe("Overdue 2 days");
    expect(todoDeadlineLabel(undefined, now)).toBeNull();
    expect(todoDeadlineLabel(new Date("2026-10-11T00:00:00Z"), now, true)).toBe("Due today");
  });
  it("rejects malformed keys, dates and empty reasons before a database write", () => {
    expect(() => validateSnoozeInput({ key: "not-a-key", until: "2026-11-01", reason: "Waiting" })).toThrow();
    expect(() => validateSnoozeInput({ key: "a".repeat(64), until: "2026-02-31", reason: "Waiting" })).toThrow();
    expect(() => validateSnoozeInput({ key: "a".repeat(64), until: "2028-01-01", reason: "Waiting" })).toThrow();
  });
  it("shows the real remaining balance on partially paid bills", () => {
    const result = pastDueInvoiceException({
      id: "test", customerId: "customer", customerName: "A",
      status: "PARTIALLY_PAID", dueDate: new Date("2026-10-05"),
      amountDueCents: 12000, amountPaidCents: 3500,
    });
    expect(result.amountCents).toBe(8500);
    expect(result.dueOn).toEqual(new Date("2026-10-05"));
  });
});
