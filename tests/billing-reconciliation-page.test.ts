import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  detectDrift: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
}));
vi.mock("@/domains/billing/reconciliation", () => ({
  detectDrift: (...args: unknown[]) => mocks.detectDrift(...args),
}));

import { loadBillingReconciliationPageData } from "@/app/desk/billing/reconciliation/page";

describe("billing reconciliation page loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ user: { id: "owner-1", role: "OWNER" } });
    mocks.detectDrift.mockResolvedValue([
      {
        kind: "FAILED_OP",
        subjectType: "CustomerCredit",
        subjectId: "credit-1",
        detail: "Balance credit provider write failed.",
        since: new Date("2026-10-02T12:00:00Z"),
      },
    ]);
  });

  it("allows OWNER/ADMIN access and loads drift only after authorization", async () => {
    const result = await loadBillingReconciliationPageData();

    expect(mocks.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN");
    expect(mocks.detectDrift).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(1);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(mocks.requireRole.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.detectDrift.mock.invocationCallOrder[0],
    );
  });

  it("rejects STAFF before drift detection runs", async () => {
    mocks.requireRole.mockRejectedValue(new Error("Forbidden"));

    await expect(loadBillingReconciliationPageData()).rejects.toThrow("Forbidden");
    expect(mocks.detectDrift).not.toHaveBeenCalled();
  });
});
