import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(async () => ({
    versions: 1,
    agreements: 1,
    updated: 1,
    alreadyCurrent: 0,
    skipped: 0,
    pending: 0,
  })),
  runAutomation: vi.fn(async (input: { ruleKey: string; work: () => Promise<unknown> }) => {
    await input.work();
    return { outcome: "RAN", runId: "run-tax-rate" };
  }),
}));

vi.mock("@/domains/automation/runs", () => ({ runAutomation: mocks.runAutomation }));
vi.mock("@/domains/tax/rate-changes", () => ({
  applyTaxRateChanges: mocks.apply,
}));

import { GET } from "@/app/api/cron/tax-rate-changes/route";

describe("Batch T tax-rate changes cron route", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "tax-rate-secret";
    mocks.apply.mockClear();
    mocks.runAutomation.mockClear();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("rejects a request without the cron bearer secret", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/tax-rate-changes"),
    );
    expect(response.status).toBe(401);
    expect(mocks.runAutomation).not.toHaveBeenCalled();
  });

  it("runs authorized work under the designed automation key", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/tax-rate-changes", {
        headers: { authorization: "Bearer tax-rate-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-rate-changes" }),
    );
  });
});
