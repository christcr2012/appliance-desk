import { describe, expect, it } from "vitest";
import {
  computePace, validateIdleDays, validateTarget, validateUtilizationPercent, isGoalMetric, PACE_QUIET_DAYS,
} from "@/domains/goals/pace";

describe("goal pace", () => {
  const base = { target: 3100, daysInMonth: 31 };
  it("is quiet during the first week even at zero", () => {
    expect(computePace({ ...base, actual: 0, dayOfMonth: PACE_QUIET_DAYS }).status).toBe("TOO_EARLY");
    expect(computePace({ ...base, actual: 0, dayOfMonth: 1 }).status).toBe("TOO_EARLY");
  });
  it("straight-line expectation, rounded", () => {
    expect(computePace({ ...base, actual: 0, dayOfMonth: 10 }).expectedSoFar).toBe(1000);
    expect(computePace({ target: 100, actual: 0, dayOfMonth: 15, daysInMonth: 30 }).expectedSoFar).toBe(50);
  });
  it("behind only under 75% of the expected amount", () => {
    expect(computePace({ ...base, actual: 749, dayOfMonth: 10 }).status).toBe("BEHIND");
    expect(computePace({ ...base, actual: 750, dayOfMonth: 10 }).status).toBe("ON_PACE");
    expect(computePace({ ...base, actual: 1500, dayOfMonth: 10 }).status).toBe("ON_PACE");
  });
  it("reaching the target wins over everything, even in the first week", () => {
    expect(computePace({ ...base, actual: 3100, dayOfMonth: 2 }).status).toBe("MET");
    expect(computePace({ ...base, actual: 5000, dayOfMonth: 31 }).percentOfTarget).toBe(161);
  });
  it("rounds the percent down so 99.9% never reads as 100%", () => {
    expect(computePace({ target: 1000, actual: 999, dayOfMonth: 20, daysInMonth: 30 }).percentOfTarget).toBe(99);
  });
});

describe("goal and alert validation", () => {
  it("targets must be positive whole numbers within a sane limit", () => {
    expect(validateTarget("cash", 0)).toBeTruthy();
    expect(validateTarget("cash", -5)).toBeTruthy();
    expect(validateTarget("cash", 1.5)).toBeTruthy();
    expect(validateTarget("cash", 500_000)).toBeNull();
    expect(validateTarget("cash", 100_000_001)).toBeTruthy();
    expect(validateTarget("newRentals", 12)).toBeNull();
    expect(validateTarget("newRentals", 100_001)).toBeTruthy();
  });
  it("idle days 0-365; utilization 1-99 or empty", () => {
    expect(validateIdleDays(0)).toBeNull();
    expect(validateIdleDays(365)).toBeNull();
    expect(validateIdleDays(366)).toBeTruthy();
    expect(validateIdleDays(-1)).toBeTruthy();
    expect(validateIdleDays(NaN)).toBeTruthy();
    expect(validateUtilizationPercent(null)).toBeNull();
    expect(validateUtilizationPercent(40)).toBeNull();
    expect(validateUtilizationPercent(0)).toBeTruthy();
    expect(validateUtilizationPercent(100)).toBeTruthy();
  });
  it("only known metrics are accepted", () => {
    expect(isGoalMetric("cash")).toBe(true);
    expect(isGoalMetric("newRentals")).toBe(true);
    expect(isGoalMetric("toString")).toBe(false);
    expect(isGoalMetric("nope")).toBe(false);
  });
});
