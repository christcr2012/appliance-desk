import { describe, expect, it } from "vitest";
import { activeCustomerDays, forecastSpend, median, ratio, type AgreementSpan } from "@/domains/messaging/telecom-unit-economics";
import { metricDefinition } from "@/domains/reports/definitions";

const d = (s: string) => new Date(s + "T12:00:00Z");
const span = (customerId: string, status: AgreementSpan["status"], startDate: string | null, closedAt: string | null = null): AgreementSpan =>
  ({ customerId, status, startDate: startDate ? d(startDate) : null, closedAt: closedAt ? d(closedAt) : null });

describe("COM-N4 unit economics (pure)", () => {
  it("counts distinct customers with an ACTIVE rental on each day", () => {
    const r = activeCustomerDays([span("a", "ACTIVE", "2026-09-01"), span("a", "ACTIVE", "2026-09-10"), span("b", "ACTIVE", "2026-09-06")],
      d("2026-09-01"), d("2026-09-10"));
    expect(r.days).toBe(10);
    expect(r.customerDays).toBe(10 + 5); // a all 10 days (second agreement is the same customer), b days 6-10
    expect(r.averageDaily).toBeCloseTo(1.5);
    expect(r.complete).toBe(true);
  });
  it("a closed rental counts through the day before it closed; not-yet-active and drafts never count", () => {
    const r = activeCustomerDays([span("a", "ENDED", "2026-09-01", "2026-09-04"), span("b", "SCHEDULED", "2026-09-02"),
      span("c", "DRAFT", null), span("d", "CANCELLED", null)], d("2026-09-01"), d("2026-09-05"));
    expect(r.customerDays).toBe(3);
    expect(r.complete).toBe(true);
  });
  it("an ended rental with no recorded end time makes history incomplete instead of guessing", () => {
    const r = activeCustomerDays([span("a", "ENDED", "2026-08-01", null)], d("2026-09-01"), d("2026-09-05"));
    expect(r.complete).toBe(false);
    expect(r.averageDaily).toBeNull();
  });
  it("no customers or a bad window is unavailable, not zero", () => {
    expect(activeCustomerDays([], d("2026-09-01"), d("2026-09-05")).averageDaily).toBeNull();
    expect(activeCustomerDays([], d("2026-09-05"), d("2026-09-01")).days).toBe(0);
  });
  it("ratios and medians never divide by zero", () => {
    expect(ratio(5, 0)).toBeNull(); expect(ratio(null, 4)).toBeNull(); expect(ratio(1, 4)).toBe(0.25);
    expect(median([])).toBeNull(); expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 10])).toBe(2.5);
  });
  it("forecast needs complete history and enough customer-days, counts fixed charges once", () => {
    expect(forecastSpend({ totalCents: 5000, fixedCents: 200, complete: false, customerDays: 100, days: 30 }).available).toBe(false);
    expect(forecastSpend({ totalCents: 5000, fixedCents: 200, complete: true, customerDays: 5, days: 30 }).available).toBe(false);
    expect(forecastSpend({ totalCents: null, fixedCents: 0, complete: true, customerDays: 100, days: 30 }).available).toBe(false);
    const f = forecastSpend({ totalCents: 5200, fixedCents: 200, complete: true, customerDays: 1000, days: 30 });
    expect(f.available).toBe(true);
    if (f.available) {
      expect(f.variableCentsPerCustomerDay).toBeCloseTo(5);
      expect(f.scenarios.map((s) => s.customers)).toEqual([200, 250, 500, 1000]);
      expect(f.scenarios[0].monthlyCents).toBe(Math.round(5 * 200 * 30 + 200)); // 30,200: fixed once, not scaled
    }
  });
  it("the new numbers are registered with honest labels", () => {
    expect(metricDefinition("telecom.projectedSpend").kind).toBe("ESTIMATE");
    expect(metricDefinition("telecom.costPerActiveCustomer").kind).toBe("ACTUAL");
    expect(metricDefinition("telecom.costPerActiveCustomer").calculation).toMatch(/unavailable/);
    expect(metricDefinition("communications.deliveryFailureRate").sources).toContain("MessageDelivery");
    expect(metricDefinition("communications.medianResponseMinutes").calculation).toMatch(/no per-employee/);
  });
});
