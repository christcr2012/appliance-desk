import { describe, it, expect } from "vitest";
import { computeChurnRisk } from "@/domains/growth/churn";

// Churn-risk scoring (Task #46, /desk/growth) — simple, explainable rules,
// same spirit as lead scoring (tests/lead-scoring.test.ts).

describe("computeChurnRisk", () => {
  it("is not at risk with nothing flagged", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.score).toBe(0);
    expect(result.atRisk).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("flags a past-due invoice with a plain-English reason", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 1,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.reasons).toEqual(["1 past-due invoice"]);
  });

  it("pluralizes correctly for more than one", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 2,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.reasons[0]).toBe("2 past-due invoices");
  });

  it("flags a term ending soon", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: 10,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.reasons[0]).toContain("10 day");
  });

  it("does not flag a term ending far in the future", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: 200,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.reasons).toEqual([]);
  });

  it("phrases an already-ended term distinctly from one ending soon", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: -5,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.reasons[0]).toBe("Term has already ended with no renewal or ending recorded");
  });

  it("only flags repeat repair requests, not a single one", () => {
    const single = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 1,
    });
    expect(single.reasons).toEqual([]);

    const repeat = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 2,
    });
    expect(repeat.reasons).toEqual(["2 repair requests in the last 90 days"]);
  });

  it("becomes at-risk once enough signals stack up", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 1, // 15
      failedPaymentsRecentCount: 1, // +10 = 25
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 0,
    });
    expect(result.score).toBe(25);
    expect(result.atRisk).toBe(true);
  });

  it("a single mild signal alone doesn't cross the at-risk threshold", () => {
    const result = computeChurnRisk({
      pastDueInvoiceCount: 0,
      failedPaymentsRecentCount: 0,
      daysUntilTermEnd: null,
      recentMaintenanceRequestCount: 2, // 10 points
    });
    expect(result.atRisk).toBe(false);
  });
});
