import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 6A item 7 — public form spam/abuse protection. These prove
// submitLead's two guards (src/app/(public)/contact/actions.ts): the
// honeypot field silently drops a bot submission without ever saving a
// Lead, and a real database error still surfaces normally when neither
// guard trips.

const createLead = vi.fn();
const isRateLimited = vi.fn();
vi.mock("@/domains/pricing", () => ({ getPublishedApplianceTypes: async () => [{ id: "type-1" }] }));

vi.mock("@/domains/leads", () => ({
  createLead: (...args: unknown[]) => createLead(...args),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.1" }),
}));

// The limiter's own sliding-window counting logic is covered in full by
// tests/rate-limit.test.ts against the real implementation — mocked
// here so this file only has to prove submitLead is wired to it
// correctly (checks it, blocks on true, never touches it for a
// honeypot hit), without depending on shared in-memory state across
// tests that all resolve to the same mocked IP.
vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: (...args: unknown[]) => isRateLimited(...args),
}));

const VALID_INPUT = {
  accountType: "individual" as const,
  isPropertyManager: false,
  companyName: "",
  contactName: "Pat Customer",
  phone: "555-123-4567",
  email: "pat@example.com",
  bestTimeToContact: "",
  howHeard: "",
  applianceTypeIds: ["type-1"],
  quantity: 1,
  desiredTerm: "month-to-month" as const,
  desiredStartDate: "",
  addressLine1: "",
  city: "",
  zip: "",
  notes: "",
  consent: true,
};

describe("submitLead — honeypot", () => {
  beforeEach(() => {
    createLead.mockReset().mockResolvedValue({ id: "lead-1" });
    isRateLimited.mockReset().mockReturnValue(false);
  });

  it("reports success but never saves a Lead when the honeypot field is filled in", async () => {
    const { submitLead } = await import("@/app/(public)/contact/actions");

    const result = await submitLead({ ...VALID_INPUT, website: "http://spam.example" });

    expect(result).toEqual({ status: "success" });
    expect(createLead).not.toHaveBeenCalled();
    // A honeypot hit is rejected before ever consulting the rate
    // limiter — no need to spend a real visitor's budget on a bot.
    expect(isRateLimited).not.toHaveBeenCalled();
  });

  it("saves a real Lead normally when the honeypot field is left blank", async () => {
    const { submitLead } = await import("@/app/(public)/contact/actions");

    const result = await submitLead({ ...VALID_INPUT, website: "" });

    expect(result).toEqual({ status: "success" });
    expect(createLead).toHaveBeenCalledTimes(1);
  });
});

describe("submitLead — rate limiting", () => {
  beforeEach(() => {
    createLead.mockReset().mockResolvedValue({ id: "lead-1" });
    isRateLimited.mockReset();
  });

  it("saves the Lead and checks the IP-keyed limiter when under the limit", async () => {
    isRateLimited.mockReturnValue(false);
    const { submitLead } = await import("@/app/(public)/contact/actions");

    const result = await submitLead({ ...VALID_INPUT, website: "" });

    expect(result).toEqual({ status: "success" });
    expect(createLead).toHaveBeenCalledTimes(1);
    expect(isRateLimited).toHaveBeenCalledWith(
      "lead-form:203.0.113.1",
      expect.objectContaining({ max: expect.any(Number), windowMs: expect.any(Number) }),
    );
  });

  it("blocks the submission (and never saves a Lead) once the limiter says the IP is over its limit", async () => {
    isRateLimited.mockReturnValue(true);
    const { submitLead } = await import("@/app/(public)/contact/actions");

    const result = await submitLead({ ...VALID_INPUT, website: "" });

    expect(result).toEqual({
      status: "error",
      message: expect.stringMatching(/wait a few minutes/i),
    });
    expect(createLead).not.toHaveBeenCalled();
  });
});
