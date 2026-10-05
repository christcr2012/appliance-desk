import { describe, expect, it } from "vitest";
import { computeCustodyUtilization } from "@/domains/growth/utilization";

const asOf = new Date("2026-10-05T18:00:00Z");
const old = new Date("2026-01-01T00:00:00Z");

function unit(episodes: Array<{ startedOn: Date | null; endedOn: Date | null; closedAt: Date | null }>, createdAt = old) {
  return { createdAt, custodyEpisodes: episodes };
}

describe("custody based utilization", () => {
  it("flags sustained current and rolling custody as a shortage", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const result = computeCustodyUtilization(
      Array.from({ length: 3 }, () => unit([{ startedOn: start, endedOn: null, closedAt: null }])),
      asOf,
    );
    expect(result.currentUtilizationFraction).toBe(1);
    expect(result.rolling30DayUtilizationFraction).toBe(1);
    expect(result.flag).toBe("SHORTAGE");
  });

  it("does not call historically busy but currently returned units a shortage", () => {
    const result = computeCustodyUtilization(
      Array.from({ length: 3 }, () =>
        unit([
          {
            startedOn: new Date("2026-01-01T00:00:00Z"),
            endedOn: new Date("2026-09-20T00:00:00Z"),
            closedAt: new Date("2026-09-20T00:00:01Z"),
          },
        ]),
      ),
      asOf,
    );
    expect(result.currentUtilizationFraction).toBe(0);
    expect(result.flag).not.toBe("SHORTAGE");
  });

  it("can flag recently full units even when old history was idle", () => {
    const start = new Date("2026-09-05T18:00:00Z");
    const result = computeCustodyUtilization(
      Array.from({ length: 3 }, () => unit([{ startedOn: start, endedOn: null, closedAt: null }])),
      asOf,
    );
    expect(result.currentUtilizationFraction).toBe(1);
    expect(result.rolling30DayUtilizationFraction).toBe(1);
    expect(result.flag).toBe("SHORTAGE");
  });

  it("does not label brand-new inventory underutilized before enough evidence exists", () => {
    const createdAt = new Date("2026-10-01T18:00:00Z");
    const result = computeCustodyUtilization(
      Array.from({ length: 3 }, () => unit([], createdAt)),
      asOf,
    );
    expect(result.currentUtilizationFraction).toBe(0);
    expect(result.rolling30DayUtilizationFraction).toBe(0);
    expect(result.flag).toBeNull();
  });

  it("counts an open manual custody episode with unknown start as occupied now without inventing rolling history", () => {
    const result = computeCustodyUtilization(
      [
        unit([{ startedOn: null, endedOn: null, closedAt: null }]),
        unit([]),
        unit([]),
      ],
      asOf,
    );
    expect(result.currentUtilizationFraction).toBeCloseTo(1 / 3);
    expect(result.rolling30DayUtilizationFraction).toBe(0);
    expect(result.flag).toBeNull();
  });
});
