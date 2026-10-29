import { describe, expect, it } from "vitest";
import { SETTING_ROWS } from "@/domains/settings/catalog";
import { DECISION_SUBJECTS } from "@/domains/decisions/registry";
import { journalActionPolicy, type JournalAction } from "@/domains/agent-control/journal";
import { buildSettingsMap, findSettings, SYSTEM_HEALTH_CONTROLS } from "@/mcp/settings-map";

describe("MCP-8 catalog-based settings and honest action coverage", () => {
  const entries = buildSettingsMap();
  it("maps every AR-8 field and decision without hand-maintaining a second settings catalog", () => {
    expect(new Set(entries.map(item => item.key)).size).toBe(entries.length);
    for (const row of SETTING_ROWS) {
      const item = entries.find(value => value.key === row.key);
      expect(item?.href).toMatch(/^\/desk\/settings/);
      expect(item?.label).toBe(row.label);
      expect(item?.mcpStatus).toBe("PLANNED");
    }
    for (const subject of DECISION_SUBJECTS) {
      expect(entries.find(item => item.key === "decision." + subject.id)).toBeDefined();
    }
  });
  it("maps System health controls with a real route and honest labels", () => {
    expect(SYSTEM_HEALTH_CONTROLS.length).toBeGreaterThanOrEqual(10);
    for (const item of SYSTEM_HEALTH_CONTROLS) {
      expect(item.href).toMatch(/^\/desk\//);
      expect(item.reason.length).toBeGreaterThan(12);
    }
  });
  it("never labels a setting TOOL without an actual MCP-5 journaled action", () => {
    for (const item of entries.filter(entry => entry.mcpStatus === "TOOL")) {
      expect(item.action).toBeTruthy();
      expect(journalActionPolicy(item.action as JournalAction)).toBeDefined();
    }
    for (const item of entries.filter(entry => entry.mcpStatus === "PROVIDER_MANUAL")) {
      expect(item.action).toBeUndefined();
    }
  });
  it("search uses real labels and protects against blank or unbounded requests", () => {
    expect(findSettings("backup").some(item => item.key === "systemHealth.backupRetry")).toBe(true);
    expect(findSettings("referral").some(item => item.key.toLowerCase().includes("referral"))).toBe(true);
    expect(findSettings("  ")).toEqual([]);
    expect(findSettings("backup", 500)).toHaveLength(Math.min(findSettings("backup").length, 20));
  });
});
