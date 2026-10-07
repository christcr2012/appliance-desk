import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recheck: vi.fn(async () => ({
    due: true,
    automaticSourceAvailable: true,
    checked: 1,
    changed: 0,
    needsReview: 0,
  })),
  runAutomation: vi.fn(async (input: { ruleKey: string; work: () => Promise<unknown> }) => {
    await input.work();
    return { outcome: "RAN", runId: "run-tax-address" };
  }),
}));

vi.mock("@/domains/automation/runs", () => ({ runAutomation: mocks.runAutomation }));
vi.mock("@/domains/tax/address-recheck", () => ({
  recheckCurrentTaxAddresses: mocks.recheck,
}));

import { GET } from "@/app/api/cron/tax-address-recheck/route";

describe("Batch T tax-address re-check cron route", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "tax-address-secret";
    mocks.recheck.mockClear();
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
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-address-recheck" }),
    );
  });
});
