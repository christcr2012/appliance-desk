import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({
  prisma: { businessSettings: { findUnique: read } },
}));
import { isLegacySmsDispatchEnabled } from "@/domains/messaging/sms-activation";

describe("SMS master activation", () => {
  it("missing settings and the email switch do not authorize SMS", async () => {
    read.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ customerEmailEnabled: true, customerSmsEnabled: false })
      .mockResolvedValueOnce({ customerEmailEnabled: false, customerSmsEnabled: true })
      .mockRejectedValueOnce(new Error('database unreachable'));
    expect(await isLegacySmsDispatchEnabled()).toBe(false);
    expect(await isLegacySmsDispatchEnabled()).toBe(false);
    expect(await isLegacySmsDispatchEnabled()).toBe(true);
    expect(await isLegacySmsDispatchEnabled()).toBe(false);
  });
});
