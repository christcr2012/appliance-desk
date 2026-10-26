import { describe, it, expect } from "vitest";
import {
  hashDeviceCookie,
  newDeviceCookieValue,
  trustedUntilFor,
  validateTrustedDeviceDays,
} from "@/domains/security/trusted-devices";

describe("validateTrustedDeviceDays", () => {
  it("accepts the whole range, including off", () => {
    expect(validateTrustedDeviceDays(0)).toBe(0);
    expect(validateTrustedDeviceDays(30)).toBe(30);
    expect(validateTrustedDeviceDays(90)).toBe(90);
    expect(validateTrustedDeviceDays("14")).toBe(14);
  });

  it("refuses anything outside 0 to 90 days, or not a whole number", () => {
    for (const bad of [-1, 91, 1.5, "soon", null, undefined, Number.NaN]) {
      expect(() => validateTrustedDeviceDays(bad)).toThrow(/whole number of days from 0 to 90/);
    }
  });
});

describe("hashDeviceCookie", () => {
  it("stores a fixed-length hash, never the cookie value itself", () => {
    const value = newDeviceCookieValue();
    const hash = hashDeviceCookie(value);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(value);
    expect(hashDeviceCookie(value)).toBe(hash);
    expect(hashDeviceCookie(newDeviceCookieValue())).not.toBe(hash);
  });
});

describe("newDeviceCookieValue", () => {
  it("is 32 random bytes, different every time", () => {
    const first = newDeviceCookieValue();
    const second = newDeviceCookieValue();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });
});

describe("trustedUntilFor", () => {
  it("is the set days from now, or null when remembering is off", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(trustedUntilFor(30, now)).toEqual(new Date("2026-11-24T12:00:00Z"));
    expect(trustedUntilFor(0, now)).toBeNull();
    expect(trustedUntilFor(-1, now)).toBeNull();
  });
});
