import { describe, expect, it } from "vitest";
import { normalizeMessageAddress } from "@/domains/messaging/suppression";

describe("message address normalization", () => {
  it("normalizes email addresses for suppression matching", () => {
    expect(normalizeMessageAddress("EMAIL", "  Person@Example.COM ")).toBe("person@example.com");
  });

  it("preserves an E.164 phone number", () => {
    expect(normalizeMessageAddress("SMS", " +13035550100 ")).toBe("+13035550100");
  });
});
