import { describe, expect, it } from "vitest";
import { chooseObservedDeliveryState } from "@/domains/messaging/delivery-state";

describe("monotonic provider observation reducer", () => {
  it("allows initial uncertainty and stronger accepted or delivered evidence", () => {
    expect(chooseObservedDeliveryState("SMS", "PENDING", "UNKNOWN")).toBe("UNKNOWN");
    expect(chooseObservedDeliveryState("SMS", "UNKNOWN", "ACCEPTED")).toBe("ACCEPTED");
    expect(chooseObservedDeliveryState("SMS", "UNKNOWN", "DELIVERED")).toBe("DELIVERED");
    expect(chooseObservedDeliveryState("SMS", "ACCEPTED", "DELIVERED")).toBe("DELIVERED");
  });
  it("never downgrades terminal, failed, or delivered states to a weaker observation", () => {
    for (const state of ["DELIVERED", "BOUNCED", "COMPLAINED", "SUPPRESSED"] as const) {
      expect(chooseObservedDeliveryState("EMAIL", state, "UNKNOWN")).toBe(state);
      expect(chooseObservedDeliveryState("SMS", state, "ACCEPTED")).toBe(state);
    }
    expect(chooseObservedDeliveryState("SMS", "FAILED", "DELIVERED")).toBe("FAILED");
    expect(chooseObservedDeliveryState("SMS", "NOT_SENT", "DELIVERED")).toBe("NOT_SENT");
    expect(chooseObservedDeliveryState("SMS", "ACCEPTED", "UNKNOWN")).toBe("ACCEPTED");
    expect(chooseObservedDeliveryState("SMS", "PENDING", "SUPPRESSED")).toBe("SUPPRESSED");
    expect(chooseObservedDeliveryState("SMS", "ACCEPTED", "SUPPRESSED")).toBe("ACCEPTED");
  });
  it("preserves email bounce/complaint but never imports them into SMS", () => {
    for (const state of ["PENDING", "UNKNOWN", "ACCEPTED"] as const) {
      expect(chooseObservedDeliveryState("EMAIL", state, "BOUNCED")).toBe("BOUNCED");
      expect(chooseObservedDeliveryState("EMAIL", state, "COMPLAINED")).toBe("COMPLAINED");
      expect(chooseObservedDeliveryState("SMS", state, "BOUNCED")).toBe(state);
    }
  });
});
