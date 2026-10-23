import { describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), flush: vi.fn(async () => true) }));
vi.mock("@sentry/nextjs", () => sentry);

import { reportBackgroundError } from "@/lib/report-error";

describe("reportBackgroundError", () => {
  it("sends the error with where it came from and waits for the flush", async () => {
    const error = new Error("boom");
    await reportBackgroundError(error, "automation:late-fees");
    expect(sentry.captureException).toHaveBeenCalledWith(error, { tags: { background: "automation:late-fees" } });
    expect(sentry.flush).toHaveBeenCalled();
  });
  it("never throws, even if Sentry itself fails", async () => {
    sentry.captureException.mockImplementationOnce(() => { throw new Error("sentry down"); });
    await expect(reportBackgroundError(new Error("x"), "t")).resolves.toBeUndefined();
  });
});
