import { describe, expect, it } from "vitest";
import { normalizeMessageAddress } from "@/domains/messaging/suppression";

describe("message address normalization", () => {
  it("normalizes email addresses for suppression matching", () => {
    expect(normalizeMessageAddress("EMAIL", "  Person@Example.COM ")).toBe("person@example.com");
  });

  it("preserves an E.164 phone number", () => {
    expect(normalizeMessageAddress("SMS", " +13035550100 ")).toBe("+13035550100");
  });

  it("canonicalizes common US phone formatting to E.164", () => {
    expect(normalizeMessageAddress("SMS", "(303) 555-0100")).toBe("+13035550100");
    expect(normalizeMessageAddress("SMS", "303-555-0100")).toBe("+13035550100");
    expect(normalizeMessageAddress("SMS", "1 303 555 0100")).toBe("+13035550100");
  });

  it("rejects an address that cannot be used as an SMS destination", () => {
    expect(() => normalizeMessageAddress("SMS", "555")).toThrow(/valid.*phone/i);
  });
});
