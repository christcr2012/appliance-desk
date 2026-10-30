import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RTC_PUBLIC_CATALOG, rtcPublicManifest } from "@/mcp/rtc-public";

describe("MCP-9 public protocol metadata cannot drift from the real MCP registry", () => {
  it("names and access modes match every registered tool in server.ts", () => {
    const text = readFileSync("src/mcp/server.ts", "utf8");
    const matches = [...text.matchAll(/registerTool\\(\\s*"(appliance_[\\w]+)"/g)];
    const observed = matches.map((m, i) => ({ name: m[1],
      readOnly: /annotations:\\s*readOnly\\b/.test(text.slice(m.index!, matches[i + 1]?.index ?? text.length)),
    }));
    expect(RTC_PUBLIC_CATALOG).toEqual(observed);
    expect(rtcPublicManifest().counts.tools).toBe(observed.length);
    expect(rtcPublicManifest().counts.writes).toBe(observed.filter(tool => !tool.readOnly).length);
  });
});
