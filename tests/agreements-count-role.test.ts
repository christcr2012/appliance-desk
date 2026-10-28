import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/prisma", () => ({
  prisma: { rentalAgreement: { count: mocks.count } },
}));
import { getAgreementsCount } from "@/domains/agreements";

// AR-4a / RENTALS spec section 1: getAgreementsCount had no role check. The
// list page allows staff, and staff counts reveal nothing beyond what their
// list shows — but an unauthenticated caller must be refused before any
// database read happens.
beforeEach(() => {
  vi.resetAllMocks();
  mocks.count.mockResolvedValue(0);
});

it("refuses an unauthenticated caller before counting", async () => {
  mocks.role.mockRejectedValue(new Error("unauthorized"));
  await expect(getAgreementsCount()).rejects.toThrow("unauthorized");
  expect(mocks.count).not.toHaveBeenCalled();
});

it.each(["OWNER", "ADMIN", "STAFF"])("allows %s and counts", async (role) => {
  mocks.role.mockResolvedValue({ user: { role } });
  mocks.count.mockResolvedValue(7);
  await expect(getAgreementsCount()).resolves.toBe(7);
  expect(mocks.role).toHaveBeenCalledWith("OWNER", "ADMIN", "STAFF");
});

it("passes the status filter through to the count", async () => {
  mocks.role.mockResolvedValue({ user: { role: "OWNER" } });
  await getAgreementsCount({ status: "ACTIVE" });
  expect(mocks.count).toHaveBeenCalledWith({ where: { status: "ACTIVE" } });
});
