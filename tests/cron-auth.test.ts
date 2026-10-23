import { describe, expect, it } from "vitest";
import { cronAuthorized } from "@/lib/cron-auth";

describe("cronAuthorized", () => {
  it("accepts only the exact bearer secret", () => {
    expect(cronAuthorized("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(cronAuthorized("Bearer s3cret-valuf", "s3cret-value")).toBe(false);
    expect(cronAuthorized("Bearer s3cret-value ", "s3cret-value")).toBe(false);
    expect(cronAuthorized("s3cret-value", "s3cret-value")).toBe(false);
    expect(cronAuthorized("bearer s3cret-value", "s3cret-value")).toBe(false);
  });
  it("refuses when the header or the configured secret is missing", () => {
    expect(cronAuthorized(null, "x")).toBe(false);
    expect(cronAuthorized("Bearer x", undefined)).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
  });
});
