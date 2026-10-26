import { describe, expect, it, vi } from "vitest";

// OPS-1: a night with no appliances yet must not use up the first-run marker, or the first real night would skip the
// 15-year look-back (Codex review finding on PR 623).
const update = vi.fn(async () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    recallWatchState: {
      upsert: vi.fn(async () => ({ id: "singleton", lastSuccessAt: null, fullFleetRequestedAt: null, fullFleetCheckedAt: null, fullFleetCursor: 0 })),
      update,
    },
    appliance: { findMany: vi.fn(async () => []) },
  },
}));

describe("recall check with an empty fleet", () => {
  it("does not record a successful first check", async () => {
    const { runRecallWatch } = await import("@/domains/recalls/watch");
    const fetchJson = vi.fn();
    const counts = await runRecallWatch(new Date("2026-10-26T11:30:00Z"), fetchJson);
    expect(counts.searches).toBe(0);
    expect(fetchJson).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).not.toHaveProperty("lastSuccessAt");
  });
});
