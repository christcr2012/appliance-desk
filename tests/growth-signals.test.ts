import { describe, it, expect } from "vitest";
import {
  flagUtilization,
  isPriceReviewDue,
  monthsSince,
  winBackReason,
  isReviewRequestCandidate,
  MIN_UNITS_FOR_UTILIZATION_FLAG,
} from "@/domains/growth/signals";

describe("flagUtilization", () => {
  it("flags a shortage when near-fully utilized with enough units to matter", () => {
    expect(flagUtilization(0.9, MIN_UNITS_FOR_UTILIZATION_FLAG)).toBe("SHORTAGE");
  });

  it("flags underutilized when mostly idle with enough units to matter", () => {
    expect(flagUtilization(0.1, MIN_UNITS_FOR_UTILIZATION_FLAG)).toBe("UNDERUTILIZED");
  });

  it("doesn't flag a middling utilization", () => {
    expect(flagUtilization(0.6, MIN_UNITS_FOR_UTILIZATION_FLAG)).toBeNull();
  });

  it("never flags a type with too few units to be meaningful, even at 100%", () => {
    expect(flagUtilization(1, MIN_UNITS_FOR_UTILIZATION_FLAG - 1)).toBeNull();
  });
});

describe("isPriceReviewDue / monthsSince", () => {
  it("is not due with no start date", () => {
    expect(isPriceReviewDue(null, new Date("2026-09-28"))).toBe(false);
  });

  it("is not due before a year has passed", () => {
    expect(isPriceReviewDue(new Date("2026-06-01"), new Date("2026-09-28"))).toBe(false);
  });

  it("is due once a year has passed", () => {
    expect(isPriceReviewDue(new Date("2025-06-01"), new Date("2026-09-28"))).toBe(true);
  });

  it("monthsSince rounds down to whole months", () => {
    expect(monthsSince(new Date("2025-06-01"), new Date("2026-09-28"))).toBeGreaterThanOrEqual(14);
  });
});

describe("winBackReason", () => {
  it("gives no reason for a lead updated recently", () => {
    expect(winBackReason("NEW", new Date("2026-09-27"), new Date("2026-09-28"))).toBeNull();
  });

  it("flags a NEW/CONTACTED lead that's gone quiet", () => {
    const reason = winBackReason("CONTACTED", new Date("2026-09-01"), new Date("2026-09-28"));
    expect(reason).toContain("27 days");
  });

  it("does not flag a freshly lost lead", () => {
    expect(winBackReason("LOST", new Date("2026-09-20"), new Date("2026-09-28"))).toBeNull();
  });

  it("flags a lost lead worth revisiting after enough time", () => {
    const reason = winBackReason("LOST", new Date("2026-06-01"), new Date("2026-09-28"));
    expect(reason).toContain("worth a second look");
  });
});

describe("isReviewRequestCandidate", () => {
  it("is false with no billing started", () => {
    expect(isReviewRequestCandidate(null, false, new Date("2026-09-28"))).toBe(false);
  });

  it("is false with a past-due invoice, even if billing a long time", () => {
    expect(isReviewRequestCandidate(new Date("2026-01-01"), true, new Date("2026-09-28"))).toBe(
      false,
    );
  });

  it("is false before the minimum billing window", () => {
    expect(isReviewRequestCandidate(new Date("2026-09-01"), false, new Date("2026-09-28"))).toBe(
      false,
    );
  });

  it("is true once billing cleanly past the minimum window", () => {
    expect(isReviewRequestCandidate(new Date("2026-01-01"), false, new Date("2026-09-28"))).toBe(
      true,
    );
  });
});
