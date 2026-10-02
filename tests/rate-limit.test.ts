import { describe, it, expect } from "vitest";
import { isRateLimited } from "@/lib/rate-limit";

function key(label: string): string {
  return `rate-limit-test:${label}:${crypto.randomUUID()}`;
}

describe("isRateLimited", () => {
  it("allows requests up to the max within the shared rolling window", async () => {
    const subject = key("max");
    const opts = { max: 3, windowMs: 60_000 };
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
  });

  it("blocks once the max is exceeded", async () => {
    const subject = key("blocked");
    const opts = { max: 2, windowMs: 60_000 };
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
    await expect(isRateLimited(subject, opts)).resolves.toBe(true);
  });

  it("keeps different keys independent", async () => {
    const opts = { max: 1, windowMs: 60_000 };
    const keyA = key("a");
    const keyB = key("b");
    await expect(isRateLimited(keyA, opts)).resolves.toBe(false);
    await expect(isRateLimited(keyA, opts)).resolves.toBe(true);
    await expect(isRateLimited(keyB, opts)).resolves.toBe(false);
  });

  it("allows a request again once the rolling window elapses", async () => {
    const subject = key("expiry");
    const opts = { max: 1, windowMs: 50 };
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
    await expect(isRateLimited(subject, opts)).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 70));
    await expect(isRateLimited(subject, opts)).resolves.toBe(false);
  });

  it("serializes concurrent requests across the database boundary", async () => {
    const subject = key("concurrent");
    const opts = { max: 3, windowMs: 60_000 };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => isRateLimited(subject, opts)),
    );
    expect(results.filter((limited) => !limited)).toHaveLength(3);
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("rejects invalid limiter configuration", async () => {
    await expect(
      isRateLimited(key("invalid"), { max: 0, windowMs: 60_000 }),
    ).rejects.toThrow("Invalid rate-limit configuration");
  });
});
