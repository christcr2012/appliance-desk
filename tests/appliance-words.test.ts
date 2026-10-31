import { describe, expect, it } from "vitest";
import { ALL_APPLIANCE_STATUSES } from "@/domains/inventory/lifecycle";
import {
  APPLIANCE_PILL,
  applianceSubtitle,
  applianceTitle,
} from "@/domains/inventory/words";

// AR-6 section 2 / spec section 9: a pill for every status, labels from
// APPLIANCE_STATUS_LABELS, tones exactly as the spec fixes them.
describe("APPLIANCE_PILL", () => {
  it("covers every appliance status", () => {
    for (const status of ALL_APPLIANCE_STATUSES) {
      expect(APPLIANCE_PILL[status], status).toBeDefined();
      expect(APPLIANCE_PILL[status].label.length).toBeGreaterThan(0);
    }
  });

  it("uses the spec's tones", () => {
    expect(APPLIANCE_PILL.AVAILABLE.tone).toBe("good");
    expect(APPLIANCE_PILL.RESERVED.tone).toBe("info");
    expect(APPLIANCE_PILL.RENTED.tone).toBe("info");
    expect(APPLIANCE_PILL.AWAITING_PICKUP.tone).toBe("attention");
    expect(APPLIANCE_PILL.AWAITING_INSPECTION.tone).toBe("attention");
    expect(APPLIANCE_PILL.CLEANING.tone).toBe("attention");
    expect(APPLIANCE_PILL.MAINTENANCE.tone).toBe("attention");
    expect(APPLIANCE_PILL.RETIRED.tone).toBe("neutral");
  });

  it("labels come from the shared status labels (In repair, Being cleaned)", () => {
    expect(APPLIANCE_PILL.MAINTENANCE.label).toBe("In repair");
    expect(APPLIANCE_PILL.CLEANING.label).toBe("Being cleaned");
  });
});

describe("applianceTitle / applianceSubtitle", () => {
  const base = { assetNumber: "W-1042", applianceType: { name: "Washer" } };

  it("title is type name + appliance number", () => {
    expect(applianceTitle({ ...base, manufacturer: "GE", model: "GFW550", color: "White" })).toBe("Washer #W-1042");
  });

  it("subtitle joins the parts that are present", () => {
    expect(applianceSubtitle({ ...base, manufacturer: "GE", model: "GFW550", color: "White" })).toBe("GE · GFW550 · White");
    expect(applianceSubtitle({ ...base, manufacturer: null, model: "GFW550", color: null })).toBe("GFW550");
    expect(applianceSubtitle({ ...base, manufacturer: " ", model: null, color: null })).toBe("No make or model yet");
  });
});
