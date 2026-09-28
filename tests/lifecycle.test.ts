import { describe, it, expect } from "vitest";
import {
  ALL_APPLIANCE_STATUSES,
  ALLOWED_APPLIANCE_TRANSITIONS,
  applianceStatusAfterInspection,
  applianceStatusOnAgreementClose,
  applianceStatusOnJobCompleted,
  canTransitionApplianceStatus,
} from "@/domains/inventory/lifecycle";

// The rental lifecycle (docs/BUSINESS-RULES.md, "Rental lifecycle"):
// reserved → delivered/rented → awaiting pickup → awaiting inspection →
// available again. Pure rules, so these run anywhere (no database).

describe("canTransitionApplianceStatus — lifecycle guard rails", () => {
  it("never lets a machine still at a customer's property become rentable to someone else", () => {
    expect(canTransitionApplianceStatus("RENTED", "AVAILABLE").ok).toBe(false);
    expect(canTransitionApplianceStatus("AWAITING_PICKUP", "AVAILABLE").ok).toBe(false);
    expect(canTransitionApplianceStatus("AWAITING_PICKUP", "RESERVED").ok).toBe(false);
  });

  it("requires inspection before a returned machine is available again", () => {
    expect(canTransitionApplianceStatus("AWAITING_PICKUP", "AWAITING_INSPECTION").ok).toBe(true);
    expect(canTransitionApplianceStatus("AWAITING_INSPECTION", "AVAILABLE").ok).toBe(true);
    expect(canTransitionApplianceStatus("AWAITING_INSPECTION", "RESERVED").ok).toBe(false);
  });

  it("lets an on-site repair finish back at RENTED", () => {
    expect(canTransitionApplianceStatus("MAINTENANCE", "RENTED").ok).toBe(true);
  });

  it("keeps RETIRED terminal and allows retiring from every other status", () => {
    expect(ALLOWED_APPLIANCE_TRANSITIONS.RETIRED).toEqual([]);
    for (const status of ALL_APPLIANCE_STATUSES) {
      if (status === "RETIRED") continue;
      expect(canTransitionApplianceStatus(status, "RETIRED").ok).toBe(true);
    }
  });

  it("uses plain-English status names in its refusal message", () => {
    const result = canTransitionApplianceStatus("RENTED", "AVAILABLE");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(
      'Can\'t move an appliance directly from "Rented" to "Available".',
    );
  });
});

describe("applianceStatusOnAgreementClose", () => {
  it("sends a delivered machine to awaiting pickup, not straight to available", () => {
    expect(applianceStatusOnAgreementClose("RENTED")).toBe("AWAITING_PICKUP");
  });

  it("frees a machine that was only ever reserved (never delivered)", () => {
    expect(applianceStatusOnAgreementClose("RESERVED")).toBe("AVAILABLE");
  });

  it("leaves a machine that's already in repair alone", () => {
    expect(applianceStatusOnAgreementClose("MAINTENANCE")).toBeNull();
  });

  it("every change it makes is itself an allowed transition", () => {
    for (const status of ALL_APPLIANCE_STATUSES) {
      const next = applianceStatusOnAgreementClose(status);
      if (next) expect(canTransitionApplianceStatus(status, next).ok).toBe(true);
    }
  });
});

describe("applianceStatusOnJobCompleted", () => {
  it("marks reserved machines rented when a delivery or installation is completed", () => {
    expect(applianceStatusOnJobCompleted("DELIVERY", "RESERVED")).toBe("RENTED");
    expect(applianceStatusOnJobCompleted("INSTALLATION", "RESERVED")).toBe("RENTED");
  });

  it("doesn't touch a delivered machine that isn't reserved (e.g. already rented)", () => {
    expect(applianceStatusOnJobCompleted("DELIVERY", "RENTED")).toBeNull();
    expect(applianceStatusOnJobCompleted("DELIVERY", "AVAILABLE")).toBeNull();
  });

  it("moves a picked-up machine to awaiting inspection", () => {
    expect(applianceStatusOnJobCompleted("REMOVAL", "AWAITING_PICKUP")).toBe("AWAITING_INSPECTION");
    expect(applianceStatusOnJobCompleted("REMOVAL", "RENTED")).toBe("AWAITING_INSPECTION");
  });

  it("leaves maintenance visits and swaps for Chris to decide", () => {
    expect(applianceStatusOnJobCompleted("MAINTENANCE_VISIT", "RENTED")).toBeNull();
    expect(applianceStatusOnJobCompleted("SWAP", "RESERVED")).toBeNull();
  });

  it("every change it makes is itself an allowed transition", () => {
    for (const type of ["DELIVERY", "INSTALLATION", "SWAP", "MAINTENANCE_VISIT", "REMOVAL"] as const) {
      for (const status of ALL_APPLIANCE_STATUSES) {
        const next = applianceStatusOnJobCompleted(type, status);
        if (next) expect(canTransitionApplianceStatus(status, next).ok).toBe(true);
      }
    }
  });
});

describe("applianceStatusAfterInspection", () => {
  it("clears a passed machine to rent again, sends a failed one to repair", () => {
    expect(applianceStatusAfterInspection(true)).toBe("AVAILABLE");
    expect(applianceStatusAfterInspection(false)).toBe("MAINTENANCE");
    expect(canTransitionApplianceStatus("AWAITING_INSPECTION", "AVAILABLE").ok).toBe(true);
    expect(canTransitionApplianceStatus("AWAITING_INSPECTION", "MAINTENANCE").ok).toBe(true);
  });
});
