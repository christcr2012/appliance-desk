import { describe, expect, it } from "vitest";
import { rtcCanDiscoverRead, rtcReadScopesForArea } from "@/mcp/rtc-read-scopes";
import type { AgentContext } from "@/domains/agent-control/authorization";

const ctx = (scopes: AgentContext["scopes"]): AgentContext => ({
  userId: "synthetic-owner", name: "Synthetic owner", role: "OWNER",
  connectionId: "synthetic-rtc", connectionLabel: "Test-only pass", scopes,
});

describe("RTC selected-area scopes are enforced at both listing and execution", () => {
  it("maps every owner-visible area to the actual MCP handler scope", () => {
    for (const area of ["health", "automation", "configuration", "backup", "repair", "optimization"])
      expect(rtcReadScopesForArea(area, false)).toEqual(["ops:read"]);
    expect(rtcReadScopesForArea("feedback", false)).toEqual(["feedback:triage"]);
    expect(rtcReadScopesForArea("decisions", false)).toEqual(["decisions:read"]);
    expect(rtcReadScopesForArea("all", false)).toEqual(["ops:read", "feedback:triage"]);
    expect(rtcReadScopesForArea("all", true)).toEqual(
      ["ops:read", "feedback:triage", "decisions:read"]);
    expect(() => rtcReadScopesForArea("unknown", false)).toThrow("INVALID_RTC_PASS_AREAS");
  });
  it("never silently grants feedback content or mutation scopes", () => {
    for (const area of ["all", "feedback", "repair", "decisions", "health"]) {
      const scopes = rtcReadScopesForArea(area, true);
      expect(scopes).not.toContain("feedback:content");
      expect(scopes).not.toContain("ops:maintain");
      expect(scopes).not.toContain("decisions:apply");
    }
  });
  it("hides feedback and decision tools without their independent grants", () => {
    expect(rtcCanDiscoverRead(ctx(["ops:read"]), "appliance_health_list_issues")).toBe(true);
    expect(rtcCanDiscoverRead(ctx(["ops:read"]), "appliance_feedback_list_reports")).toBe(false);
    expect(rtcCanDiscoverRead(ctx(["ops:read"]), "appliance_decisions_list")).toBe(false);
    expect(rtcCanDiscoverRead(ctx(["feedback:triage"]), "appliance_feedback_list_reports")).toBe(true);
    expect(rtcCanDiscoverRead(ctx(["feedback:triage"]), "appliance_health_list_issues")).toBe(false);
    expect(rtcCanDiscoverRead(ctx(["decisions:read"]), "appliance_decisions_list")).toBe(true);
    expect(rtcCanDiscoverRead(ctx(["decisions:read"]), "appliance_backup_get_status")).toBe(false);
    expect(rtcCanDiscoverRead(ctx(["decisions:read"]), "appliance_whoami")).toBe(true);
  });
});
