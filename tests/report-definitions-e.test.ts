import { describe, expect, it } from "vitest";
import { METRICS } from "@/domains/reports/definitions";

describe("Batch E report contracts", () => {
  it("keeps one authoritative definition for every metric key", () => {
    const entries = Object.entries(METRICS);
    const declaredKeys = entries.map(([key, definition]) => {
      expect(definition.key).toBe(key);
      expect(definition.sources.length).toBeGreaterThan(0);
      expect(definition.drillHref({})).toMatch(/^\//);
      return definition.key;
    });
    expect(new Set(declaredKeys).size).toBe(declaredKeys.length);
  });

  it("defines utilization from physical custody, never assignment bookkeeping", () => {
    const utilization = METRICS["fleet.utilization"];
    expect(utilization.sources.join(" ").toLowerCase()).toContain("custody");
    expect(utilization.calculation.toLowerCase()).toContain("rolling");
    expect(utilization.sources.join(" ").toLowerCase()).not.toContain("assignment");
    expect(utilization.calculation.toLowerCase()).toContain("assignment rows do not change this metric");
  });

  it("defines win-back from real contact evidence and growth fleet flags from recent custody", () => {
    expect(METRICS["growth.winBack"].calculation.toLowerCase()).toContain("last-real-contact");
    expect(METRICS["growth.fleetFlags"].sources.join(" ").toLowerCase()).toContain("custody");
    expect(METRICS["growth.fleetFlags"].dateBasis.toLowerCase()).toContain("30-day");
  });
});
