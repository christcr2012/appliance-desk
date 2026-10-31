import { describe, expect, it } from "vitest";
import { parseRtcReadInput, projectRtcRead } from "@/mcp/rtc-projection";

describe("MCP-9 guarded fields and detail projection", () => {
  it("strips protocol metadata before strict MCP domain validation", () => {
    const input = parseRtcReadInput({ issueId: "synthetic", detail: "full",
      fields: ["status", "verification.state"] });
    expect(input.domainArgs).toEqual({ issueId: "synthetic" });
    expect(projectRtcRead({ status: "OPEN", verification: { state: "PENDING", secret: "never" },
      customerId: "synthetic-identity" }, input.paths))
      .toEqual({ status: "OPEN", verification: { state: "PENDING" } });
  });
  it("accepts RTC 1 string fields and refuses unsafe selectors", () => {
    const selection = parseRtcReadInput({ fields: "role" });
    expect(projectRtcRead({ role: "OWNER", private: 123 }, selection.paths)).toEqual({ role: "OWNER" });
    for (const bad of ["__proto__", "role.constructor", "name[0]", "a".repeat(100)]) {
      expect(() => parseRtcReadInput({ fields: bad })).toThrow("invalid_args");
    }
    expect(() => parseRtcReadInput({ detail: "dangerous" })).toThrow("invalid_args");
    expect(() => parseRtcReadInput({ fields: [] })).toThrow("invalid_args");
  });
  it("does not manufacture missing fields or reveal other attributes", () => {
    const { paths } = parseRtcReadInput({ fields: ["missing", "info.level"] });
    expect(projectRtcRead({ info: { level: "SAFE", token: "private" } }, paths))
      .toEqual({ info: { level: "SAFE" } });
  });
});
