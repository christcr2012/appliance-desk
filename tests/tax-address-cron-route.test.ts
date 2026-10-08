import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recheck: vi.fn(async () => ({
    due: true,
    automaticSourceAvailable: true,
    checked: 1,
    changed: 0,
    needsReview: 0,
  })),
  runWatch: vi.fn(async () => ({
    checked: 0,
    changed: 0,
    recovered: 0,
    failed: 0,
  })),
  runRates: vi.fn(async () => ({
    status: "UNSUPPORTED" as const,
    observations: 0,
    autoApplied: 0,
    reviewRequired: 0,
    ignored: 0,
  })),
  runAutomation: vi.fn(async (input: { ruleKey: string; work: () => Promise<unknown> }) => {
    try {
      await input.work();
      return { outcome: "RAN", runId: `run-${input.ruleKey}` };
    } catch {
      return { outcome: "FAILED", runId: `run-${input.ruleKey}` };
    }
  }),
}));

vi.mock("@/domains/automation/runs", () => ({ runAutomation: mocks.runAutomation }));
vi.mock("@/domains/tax/address-recheck", () => ({
  recheckCurrentTaxAddresses: mocks.recheck,
}));
vi.mock("@/domains/tax/official-source-watch", () => ({
  runOfficialSourceWatch: mocks.runWatch,
}));
vi.mock("@/domains/tax/official-rate-auto-apply", () => ({
  runOfficialRateObservation: mocks.runRates,
}));

import { GET } from "@/app/api/cron/tax-address-recheck/route";

describe("Batch T tax-address re-check cron route", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "tax-address-secret";
    mocks.recheck.mockClear();
    mocks.runWatch.mockClear();
    mocks.runRates.mockClear();
    mocks.runRates.mockResolvedValue({
      status: "UNSUPPORTED",
      observations: 0,
      autoApplied: 0,
      reviewRequired: 0,
      ignored: 0,
    });
    mocks.runWatch.mockResolvedValue({
      checked: 0,
      changed: 0,
      recovered: 0,
      failed: 0,
    });
    mocks.runAutomation.mockClear();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("rejects a request without the cron bearer secret", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/tax-address-recheck"),
    );
    expect(response.status).toBe(401);
    expect(mocks.runAutomation).not.toHaveBeenCalled();
  });

  it("runs authorized work under the designed automation key", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/tax-address-recheck", {
        headers: { authorization: "Bearer tax-address-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.recheck).toHaveBeenCalledTimes(1);
    expect(mocks.runWatch).toHaveBeenCalledTimes(1);
    expect(mocks.runRates).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomation).toHaveBeenCalledTimes(2);
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-address-recheck" }),
    );
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-rate-watch" }),
    );
    await expect(response.json()).resolves.toEqual({
      addressRecheck: {
        outcome: "RAN",
        runId: "run-tax-address-recheck",
      },
      taxRateWatch: {
        outcome: "RAN",
        runId: "run-tax-rate-watch",
      },
    });
  });

  it("keeps address re-check successful when the official-rate observation fails", async () => {
    mocks.runRates.mockRejectedValueOnce(new Error("GIS unavailable"));

    const response = await GET(
      new Request("https://example.test/api/cron/tax-address-recheck", {
        headers: { authorization: "Bearer tax-address-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      addressRecheck: {
        outcome: "RAN",
        runId: "run-tax-address-recheck",
      },
      taxRateWatch: {
        outcome: "FAILED",
        runId: "run-tax-rate-watch",
      },
    });
    expect(mocks.recheck).toHaveBeenCalledTimes(1);
  });

  it("keeps address re-check successful when the source-watch automation fails", async () => {
    mocks.runWatch.mockRejectedValueOnce(new Error("source unavailable"));

    const response = await GET(
      new Request("https://example.test/api/cron/tax-address-recheck", {
        headers: { authorization: "Bearer tax-address-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      addressRecheck: {
        outcome: "RAN",
        runId: "run-tax-address-recheck",
      },
      taxRateWatch: {
        outcome: "FAILED",
        runId: "run-tax-rate-watch",
      },
    });
    expect(mocks.recheck).toHaveBeenCalledTimes(1);
  });
});
