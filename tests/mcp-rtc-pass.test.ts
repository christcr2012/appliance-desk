import { describe, expect, it } from "vitest";
import { isRtcPass, newRtcPassSecret } from "@/domains/agent-control/passes";
import { pageRtcPayload } from "@/domains/agent-control/rtc-results";

describe("MCP-9 pinned RTC 1 pass credential shape", () => {
  it("uses 32 unpredictable bytes, strict base64url and exactly the pinned prefix", () => {
    const secrets = new Set(Array.from({ length: 100 }, () => newRtcPassSecret()));
    expect(secrets.size).toBe(100);
    for (const secret of secrets) {
      expect(secret).toMatch(/^rtc_pass_[A-Za-z0-9_-]{43}$/);
      expect(isRtcPass(secret)).toBe(true);
      expect(Buffer.from(secret.slice(9), "base64url")).toHaveLength(32);
    }
  });
  it("rejects malformed and OAuth-shaped credentials", () => {
    expect(isRtcPass("")).toBe(false);
    expect(isRtcPass("abc_" + "a".repeat(43))).toBe(false);
    expect(isRtcPass("rtc_pass_" + "a".repeat(42))).toBe(false);
    expect(isRtcPass("rtc_pass_" + "a".repeat(44))).toBe(false);
    expect(isRtcPass("rtc_pass_" + "a".repeat(42) + "=")).toBe(false);
  });
});

describe("MCP-9 UTF-8-bounded 24-hour result pages", () => {
  it("returns contiguous <=4096-byte pages with exact round-trip UTF-8", () => {
    const value = { content: "A 🧰 — ".repeat(2400), items: [1, 2, 3] };
    const first = pageRtcPayload(value, 1);
    expect(first.pages).toBeGreaterThan(2);
    const all = Array.from({ length: first.pages }, (_, i) => pageRtcPayload(value, i + 1));
    for (const row of all) {
      expect(Buffer.byteLength(row.content, "utf8")).toBeLessThanOrEqual(4096);
      expect(row.bytes).toBe(Buffer.byteLength(JSON.stringify(value), "utf8"));
    }
    expect(all.map(row => row.content).join("")).toBe(JSON.stringify(value));
    expect(all.at(-1)?.next).toBeNull();
    expect(() => pageRtcPayload(value, first.pages + 1)).toThrow("RTC_RESULT_NOT_FOUND");
  });
});
