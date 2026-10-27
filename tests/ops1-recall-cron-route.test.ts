import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watch: vi.fn(async () => ({ searches: 2, failedSearches: 0, newPossibleMatches: 1, fleetChecked: 0 })),
  runAutomation: vi.fn(async (input: { ruleKey: string; work: () => Promise<unknown> }) => {
    await input.work();
    return { outcome: "RAN", runId: "run-recall" };
  }),
}));
vi.mock("@/domains/automation/runs", () => ({ runAutomation: mocks.runAutomation }));
vi.mock("@/domains/recalls/watch", () => ({ runRecallWatch: mocks.watch }));

import { GET } from "@/app/api/cron/recall-watch/route";

describe("OPS-1 recall-watch cron route", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "recall-secret";
    mocks.watch.mockClear();
    mocks.runAutomation.mockClear();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("refuses without the cron secret and does no work", async () => {
    const response = await GET(new Request("https://example.test/api/cron/recall-watch"));
    expect(response.status).toBe(401);
    expect(mocks.runAutomation).not.toHaveBeenCalled();
    expect(mocks.watch).not.toHaveBeenCalled();
  });

  it("refuses when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("https://example.test/api/cron/recall-watch", { headers: { authorization: "Bearer x" } }));
    expect(response.status).toBe(500);
    expect(mocks.watch).not.toHaveBeenCalled();
  });

  it("runs the check under its own automation key", async () => {
    const response = await GET(new Request("https://example.test/api/cron/recall-watch", { headers: { authorization: "Bearer recall-secret" } }));
    expect(response.status).toBe(200);
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ ruleKey: "recall-watch" }));
    expect(mocks.watch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ recalls: { outcome: "RAN", runId: "run-recall" } });
  });

  it("reports a failed run instead of crashing", async () => {
    mocks.runAutomation.mockRejectedValueOnce(new Error("boom"));
    const response = await GET(new Request("https://example.test/api/cron/recall-watch", { headers: { authorization: "Bearer recall-secret" } }));
    expect(await response.json()).toEqual({ recalls: { outcome: "FAILED", runId: null } });
  });
});
