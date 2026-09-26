import { describe, it, expect } from "vitest";
import {
  canTransitionApplianceStatus,
  assetNumberPrefix,
  buildAssetNumber,
} from "@/domains/inventory";

// canTransitionApplianceStatus is the pure rule updateApplianceStatus
// (src/domains/inventory/index.ts) enforces server-side before changing an
// appliance's status — see docs/BUSINESS-RULES.md ("Appliance statuses...
// live in one central enum with clear rules for which transitions are
// allowed"). Pure and exported specifically so it's unit-testable despite
// the rest of that file needing a real database.
describe("canTransitionApplianceStatus", () => {
  it("allows moving an available appliance to rented", () => {
    expect(canTransitionApplianceStatus("AVAILABLE", "RENTED")).toEqual({
      ok: true,
    });
  });

  it("allows moving a rented appliance back to available", () => {
    expect(canTransitionApplianceStatus("RENTED", "AVAILABLE")).toEqual({
      ok: true,
    });
  });

  it("allows retiring from any non-retired status", () => {
    expect(canTransitionApplianceStatus("MAINTENANCE", "RETIRED")).toEqual({
      ok: true,
    });
  });

  it("rejects moving to the same status", () => {
    const result = canTransitionApplianceStatus("AVAILABLE", "AVAILABLE");
    expect(result.ok).toBe(false);
  });

  it("rejects any transition out of retired — it's terminal", () => {
    const result = canTransitionApplianceStatus("RETIRED", "AVAILABLE");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/RETIRED/);
    }
  });
});

describe("assetNumberPrefix", () => {
  it("uses the first 4 letters for a single-word name", () => {
    expect(assetNumberPrefix("Washer")).toBe("WASH");
    expect(assetNumberPrefix("Dryer")).toBe("DRYE");
  });

  it("uses initials for a multi-word name", () => {
    expect(assetNumberPrefix("Washer + Dryer Set")).toBe("WDS");
  });

  it("falls back to APPL for a name with no letters/numbers", () => {
    expect(assetNumberPrefix("!!!")).toBe("APPL");
  });
});

describe("buildAssetNumber", () => {
  it("pads the sequence to 4 digits", () => {
    expect(buildAssetNumber("WASH", 1)).toBe("WASH-0001");
    expect(buildAssetNumber("WASH", 42)).toBe("WASH-0042");
  });
});
