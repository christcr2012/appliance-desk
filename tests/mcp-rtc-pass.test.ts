import { describe, expect, it } from "vitest";
import { isRtcPass, newRtcPassSecret } from "@/domains/agent-control/passes";

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
