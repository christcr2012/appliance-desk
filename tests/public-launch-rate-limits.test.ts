import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limited: vi.fn(),
  confirm: vi.fn(),
  unsubscribe: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ isRateLimited: mocks.limited }));
vi.mock("@/domains/launch", () => ({
  confirmLaunchSubscription: mocks.confirm,
  unsubscribeLaunch: mocks.unsubscribe,
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

import LaunchConfirmPage from "@/app/launch/confirm/[token]/page";
import { POST as unsubscribePost } from "@/app/launch/unsubscribe/route";

describe("public launch abuse limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limited.mockResolvedValue(false);
    mocks.confirm.mockResolvedValue(true);
    mocks.unsubscribe.mockResolvedValue(true);
    mocks.headers.mockResolvedValue({
      get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.10" : null),
    });
  });

  it("rate-limits mailbox confirmation before consuming the token", async () => {
    mocks.limited.mockResolvedValueOnce(true);
    await LaunchConfirmPage({ params: Promise.resolve({ token: "a".repeat(64) }) });
    expect(mocks.limited).toHaveBeenCalledWith("launch-confirm:203.0.113.10", {
      max: 10,
      windowMs: 10 * 60 * 1000,
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("rate-limits unsubscribe POST before mutating subscriber state", async () => {
    mocks.limited.mockResolvedValueOnce(true);
    const request = new Request("https://example.test/launch/unsubscribe", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "203.0.113.11",
      },
      body: new URLSearchParams({ token: "b".repeat(64) }),
    });
    const response = await unsubscribePost(request);
    expect(response.status).toBe(429);
    expect(mocks.limited).toHaveBeenCalledWith("launch-unsubscribe:203.0.113.11", {
      max: 30,
      windowMs: 60 * 60 * 1000,
    });
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
});
