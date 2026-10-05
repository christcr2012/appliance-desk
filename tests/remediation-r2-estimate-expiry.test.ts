import { describe, expect, it } from "vitest";

import {
  estimateExpiresAt,
  isEstimatePastValidity,
  parseEstimateValidUntil,
} from "@/domains/estimates/validity";

describe("R09 estimate validity is a Colorado calendar day", () => {
  it.each([
    ["winter", "2026-01-15", "2026-01-16T07:00:00.000Z"],
    ["summer", "2026-07-15", "2026-07-16T06:00:00.000Z"],
    ["spring-forward day", "2026-03-08", "2026-03-09T06:00:00.000Z"],
    ["fall-back day", "2026-11-01", "2026-11-02T07:00:00.000Z"],
  ])("%s: valid through the whole day, expired at next Colorado midnight", (_n, key, expiresIso) => {
    const stored = parseEstimateValidUntil(key);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(estimateExpiresAt(stored.value!).toISOString()).toBe(expiresIso);
    const expires = new Date(expiresIso).getTime();
    expect(isEstimatePastValidity(stored.value, new Date(expires - 1))).toBe(false);
    expect(isEstimatePastValidity(stored.value, new Date(expires))).toBe(true);
  });

  it("an old row stored as midnight UTC still means the date that was typed", () => {
    const legacy = new Date("2026-07-15");
    expect(estimateExpiresAt(legacy).toISOString()).toBe("2026-07-16T06:00:00.000Z");
    expect(isEstimatePastValidity(legacy, new Date("2026-07-15T20:00:00Z"))).toBe(false);
  });

  it("no deadline never expires", () => {
    expect(isEstimatePastValidity(null)).toBe(false);
  });

  it.each(["2026-02-30", "10/05/2026", "tomorrow", "2026-13-01", "2026-1-5"])(
    "rejects %s instead of guessing",
    (bad) => expect(parseEstimateValidUntil(bad)).toEqual({ ok: false }),
  );

  it("blank is no deadline", () => {
    expect(parseEstimateValidUntil("  ")).toEqual({ ok: true, value: null });
  });
});
