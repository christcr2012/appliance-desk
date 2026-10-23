import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, capabilityAllowed } from "@/domains/capabilities";

// Batch O-2A: the rule is "no behaviour change until the owner limits an admin".
describe("capability defaults equal today's fixed rules (pure)", () => {
  it("owner and admin can do every listed action, staff and customers none, for every capability", () => {
    for (let i = 0; i < CAPABILITY_KEYS.length; i++) {
      expect(capabilityAllowed("OWNER", null)).toBe(true);
      expect(capabilityAllowed("ADMIN", null)).toBe(true);
      expect(capabilityAllowed("STAFF", null)).toBe(false);
      expect(capabilityAllowed("CUSTOMER", null)).toBe(false);
    }
  });
  it("a limit takes an admin's permission away, the owner cannot be limited, and nothing is ever granted to staff", () => {
    expect(capabilityAllowed("ADMIN", false)).toBe(false);
    expect(capabilityAllowed("ADMIN", true)).toBe(true);
    expect(capabilityAllowed("OWNER", false)).toBe(true);
    expect(capabilityAllowed("STAFF", true)).toBe(false);
  });
  it("lists the seven capabilities guarded in this release", () => {
    expect([...CAPABILITY_KEYS].sort()).toEqual([
      "EDIT_SETTINGS", "ISSUE_REFUND", "POST_EXPENSES", "RECORD_MANUAL_PAYMENT", "REFUND_DEPOSIT", "RESOLVE_HELD_PAYMENT", "WRITE_OFF",
    ]);
  });
});
