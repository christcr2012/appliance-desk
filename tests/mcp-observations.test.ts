import { describe, expect, it } from "vitest";
import { measure, percentile, safePerformanceName } from "@/domains/agent-control/performance";

describe("MCP-8 privacy-safe performance timing", () => {
  it("refuses raw routes, query parameters and private label values", () => {
    expect(safePerformanceName("PAGE", "desk:system-health")).toBe(true);
    expect(safePerformanceName("PAGE", "/desk/customer/123?email=private@example.test")).toBe(false);
    expect(safePerformanceName("QUERY", "SELECT * FROM User")).toBe(false);
    expect(safePerformanceName("ACTION", "monitor-rule-save")).toBe(true);
  });
  it("samples page actions at 10% and always samples jobs", async () => {
    const writes: unknown[] = [];
    const opts = { random: () => 0.9, clock: (() => { let n = 0; return () => n += 10; })(),
      write: async (row: unknown) => { writes.push(row); } };
    expect(await measure("PAGE", "desk:system-health", async () => "ready", opts)).toBe("ready");
    expect(writes).toHaveLength(0);
    await measure("JOB", "system-issues-sweep", async () => "success", opts);
    expect(writes).toHaveLength(1);
  });
  it("records milliseconds and outcome only; telemetry failure cannot change a result", async () => {
    const writes: unknown[] = [];
    const options = { random: () => 0, clock: (() => { let n = 0; return () => n += 25; })(),
      now: () => new Date("2026-10-29T18:00:00Z"),
      write: async (row: unknown) => { writes.push(row); throw new Error("metrics storage down"); } };
    const result = await measure("ACTION", "monitor-rule-save", async () => 42, options);
    expect(result).toBe(42);
    expect(writes).toEqual([{
      kind: "ACTION", name: "monitor-rule-save", ms: 25, ok: true, at: new Date("2026-10-29T18:00:00Z"),
    }]);
    await expect(measure("ACTION", "monitor-rule-save", async () => {
      throw new Error("domain failed");
    }, options)).rejects.toThrow("domain failed");
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ ok: false });
  });
  it("implements exact nearest rank p50/p95 boundaries", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile(Array.from({ length: 30 }, (_, i) => i + 1), 0.5)).toBe(15);
    expect(percentile(Array.from({ length: 30 }, (_, i) => i + 1), 0.95)).toBe(29);
    expect(percentile([1, 10, 100], 0.95)).toBe(100);
    expect(percentile([2, 4, 6], 2)).toBeNull();
  });
});
