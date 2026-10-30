import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/prisma", () => ({
  prisma: { estimate: { findUnique: mocks.findUnique } },
}));
import { getEstimateDetail } from "@/domains/estimates";

// AR-4d / QUOTES-MESSAGES spec section 1: getEstimateDetail had no role check
// of its own. Quotes are OWNER/ADMIN end to end, so an unauthorized caller
// must be refused before any database read happens.
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue({ id: "est-1", status: "DRAFT" });
});

it("refuses an unauthorized caller before reading", async () => {
  mocks.role.mockRejectedValue(new Error("unauthorized"));
  await expect(getEstimateDetail("est-1")).rejects.toThrow("unauthorized");
  expect(mocks.findUnique).not.toHaveBeenCalled();
});

it.each(["OWNER", "ADMIN"])("allows %s and reads the detail", async (role) => {
  mocks.role.mockResolvedValue({ user: { role } });
  await expect(getEstimateDetail("est-1")).resolves.toEqual({ id: "est-1", status: "DRAFT" });
  expect(mocks.role).toHaveBeenCalledWith("OWNER", "ADMIN");
  expect(mocks.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "est-1" } }),
  );
});
