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
  filing: vi.fn(async () => ({ periodsCreated: 0, emailsQueued: 0, licenseAlerts: 0, amendmentsDetected: 0 })),
  runAutomation: vi.fn(async (input: { ruleKey: string; work: () => Promise<unknown> }) => {
    await input.work();
    return { outcome: "RAN", runId: "run-tax-rate" };
  }),
}));

vi.mock("@/domains/automation/runs", () => ({ runAutomation: mocks.runAutomation }));
vi.mock("@/domains/tax/filing-reminders", () => ({ runTaxFilingCalendar: mocks.filing }));
vi.mock("@/domains/tax/rate-changes", () => ({
  applyTaxRateChanges: mocks.apply,
}));

import { GET } from "@/app/api/cron/tax-rate-changes/route";

describe("Batch T tax-rate changes cron route", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "tax-rate-secret";
    mocks.apply.mockReset().mockResolvedValue({ versions: 1, agreements: 1, updated: 1, alreadyCurrent: 0, skipped: 0, pending: 0 });
    mocks.filing.mockReset().mockResolvedValue({ periodsCreated: 0, emailsQueued: 0, licenseAlerts: 0, amendmentsDetected: 0 });
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
    expect(mocks.filing).not.toHaveBeenCalled();
  });

  it("runs authorized work under the designed automation key", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/tax-rate-changes", {
        headers: { authorization: "Bearer tax-rate-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(mocks.filing).toHaveBeenCalledTimes(1);
    expect(mocks.runAutomation).toHaveBeenCalledTimes(2);
    expect(mocks.runAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: "tax-rate-changes" }),
    );
  });
  it("keeps filing reminders running even when the rate automation fails", async () => {
    mocks.runAutomation.mockImplementation(async ({ ruleKey, work }) => {
      if (ruleKey === "tax-rate-changes") throw new Error("synthetic rate outage");
      await work();
      return { outcome: "RAN", runId: "filing-run" };
    });
    const response = await GET(new Request("https://example.test/api/cron/tax-rate-changes", {
      headers: { authorization: "Bearer tax-rate-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rates: { outcome: "FAILED" },
      filing: { outcome: "RAN" },
    });
    expect(mocks.filing).toHaveBeenCalledOnce();
  });

  it("does not attempt either automation when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const result = await GET(new Request("https://example.test/api/cron/tax-rate-changes"));
    expect(result.status).toBe(500);
    expect(mocks.runAutomation).not.toHaveBeenCalled();
  });
});
