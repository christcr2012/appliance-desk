import { describe, expect, it } from "vitest";
import { MONITOR_KEYS, validateMonitorSettings } from "@/domains/agent-control/monitoring";
const valid = { key: "open-high-issues", enabled: true, failuresBeforeAlert: 2,
  cooldownHours: 24, notifyEmail: false };
describe("MCP-7 owner monitor policy", () => {
  it("only allows fixed built-in rules", () => {
    expect(MONITOR_KEYS).toContain("open-high-issues");
    expect(() => validateMonitorSettings({ ...valid, key: "https://attacker.invalid" })).toThrow();
    expect(() => validateMonitorSettings({ ...valid, key: "heartbeat" })).toThrow();
  });
  it("limits thresholds and cooldown without truncation", () => {
    for (const value of [0, 11, 1.5, NaN]) {
      expect(() => validateMonitorSettings({ ...valid, failuresBeforeAlert: value })).toThrow();
    }
    for (const value of [0, 169, 3.2, Infinity]) {
      expect(() => validateMonitorSettings({ ...valid, cooldownHours: value })).toThrow();
    }
    expect(() => validateMonitorSettings(valid)).not.toThrow();
  });
  it("allowlists only scoped delegated actions with an explicit paired connection", () => {
    expect(() => validateMonitorSettings({ ...valid, autoAction: "RUN_DIAGNOSTIC_SWEEP",
      autoActionConnectionId: "connection-1" })).not.toThrow();
    expect(() => validateMonitorSettings({ ...valid, autoAction: "RETRY_DATABASE_BACKUP",
      autoActionConnectionId: "connection-1" })).not.toThrow();
    expect(() => validateMonitorSettings({ ...valid, autoAction: "REPAIR_CREATE_CASE",
      autoActionConnectionId: "connection-1" })).toThrow("not permitted");
    expect(() => validateMonitorSettings({ ...valid, autoAction: "RUN_DIAGNOSTIC_SWEEP" }))
      .toThrow("both");
    expect(() => validateMonitorSettings({ ...valid, autoActionConnectionId: "connection-1" }))
      .toThrow("both");
  });
});
