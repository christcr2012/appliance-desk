import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateChanges: vi.fn(async () => ({ updated: 1 })),
  addressRecheck: vi.fn(async () => ({ checked: 1 })),
  runAutomation: vi.fn(async (input: { ruleKey: string; work: () => Promise<unknown> }) => ({
    outcome: "RAN",
    ruleKey: input.ruleKey,
    result: await input.work(),
  })),
}));

vi.mock("@/domains/automation/runs", () => ({
  runAutomation: mocks.runAutomation,
}));
vi.mock("@/domains/tax/rate-changes", () => ({
  applyTaxRateChanges: mocks.rateChanges,
}));
vi.mock("@/domains/tax/address-recheck", () => ({
  recheckCurrentTaxAddresses: mocks.addressRecheck,
}));

import { GET as rateChangesGet } from "@/app/api/cron/tax-rate-changes/route";
import { GET as addressRecheckGet } from "@/app/api/cron/tax-address-recheck/route";

describe("Batch T tax cron routes", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "tax-cron-secret";
    mocks.rateChanges.mockClear();
    mocks.addressRecheck.mockClear();
    mocks.runAutomation.mockClear();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("rejects requests without the cron bearer secret", async () => {
    const request = new Request("https://example.test/api/cron/tax-rate-changes");
    expect((await rateChangesGet(request)).status).toBe(401);
    expect(mocks.runAutomation).not.toHaveBeenCalled();

    const recheck = new Request("https://example.test/api/cron/tax-address-recheck");
    expect((await addressRecheckGet(recheck)).status).toBe(401);
    expect(mocks.runAutomation).not.toHaveBeenCalled();
  });

  it("runs each authorized job under its designed automation key", async () => {
    const headers = { authorization: "Bearer tax-cron-secret" };

    const rateResponse = await rateChangesGet(
      new Request("https://example.test/api/cron/tax-rate-changes", { headers }),
    );
    expect(rateResponse.status).toBe(200);
    expect(mocks.rateChanges).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-rate-changes" }),
    );

    const addressResponse = await addressRecheckGet(
      new Request("https://example.test/api/cron/tax-address-recheck", { headers }),
    );
    expect(addressResponse.status).toBe(200);
    expect(mocks.addressRecheck).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-address-recheck" }),
    );
  });
});
