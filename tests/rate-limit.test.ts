import { describe, it, expect } from "vitest";
import { isRateLimited } from "@/lib/rate-limit";

// Pure, in-memory sliding-window limiter (see src/lib/rate-limit.ts's
// doc comment for the honest "best effort, per-instance" caveat this
// deliberately accepts). Each test uses its own unique key so tests
// never interfere with each other's window.

describe("isRateLimited", () => {
  it("allows requests up to the max within the window", () => {
    const key = `k-${Math.random()}`;
    const opts = { max: 3, windowMs: 60_000 };
    expect(isRateLimited(key, opts)).toBe(false);
    expect(isRateLimited(key, opts)).toBe(false);
    expect(isRateLimited(key, opts)).toBe(false);
  });

  it("blocks the request once the max is exceeded within the window", () => {
    const key = `k-${Math.random()}`;
    const opts = { max: 2, windowMs: 60_000 };
    expect(isRateLimited(key, opts)).toBe(false);
    expect(isRateLimited(key, opts)).toBe(false);
    expect(isRateLimited(key, opts)).toBe(true);
  });

  it("keeps different keys (e.g. different IPs) independent", () => {
    const opts = { max: 1, windowMs: 60_000 };
    const keyA = `a-${Math.random()}`;
    const keyB = `b-${Math.random()}`;
    expect(isRateLimited(keyA, opts)).toBe(false);
    expect(isRateLimited(keyA, opts)).toBe(true);
    // keyB has never been used, so it isn't affected by keyA's usage.
    expect(isRateLimited(keyB, opts)).toBe(false);
  });

  it("allows a request again once the window has fully elapsed", async () => {
    const key = `k-${Math.random()}`;
    const opts = { max: 1, windowMs: 50 };
    expect(isRateLimited(key, opts)).toBe(false);
    expect(isRateLimited(key, opts)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(isRateLimited(key, opts)).toBe(false);
  });
});
