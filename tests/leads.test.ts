import { describe, it, expect } from "vitest";
import { canConvertLead } from "@/domains/leads";

// canConvertLead is the pure guard convertLeadToCustomer (src/domains/leads/
// index.ts) checks before touching the database — kept pure and exported
// specifically so it's unit-testable despite the rest of that file needing
// a real database connection (see docs/DECISIONS.md's sandbox-Prisma note).
describe("canConvertLead", () => {
  it("allows a fresh lead with an email", () => {
    expect(canConvertLead({ status: "NEW", email: "a@example.com" })).toEqual({
      ok: true,
    });
  });

  it("allows a contacted lead with an email", () => {
    expect(
      canConvertLead({ status: "CONTACTED", email: "a@example.com" }),
    ).toEqual({ ok: true });
  });

  it("rejects a lead with no email", () => {
    const result = canConvertLead({ status: "NEW", email: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/email/i);
    }
  });

  it("rejects a lead that's already been converted", () => {
    const result = canConvertLead({
      status: "CONVERTED",
      email: "a@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/already/i);
    }
  });
});
