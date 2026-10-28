import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  role: "OWNER",
  findMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { rentalAgreement: { findMany: data.findMany } },
}));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "owner-fixture", role: data.role } })),
}));

import { getRentals } from "@/domains/agreements/rentals-list";

beforeEach(() => {
  data.role = "OWNER";
  data.findMany.mockReset();
});

describe("rentals list when a concurrent writer deletes a row", () => {
  for (const role of ["OWNER", "STAFF"]) {
    it("omits missing rows instead of returning undefined for " + role, async () => {
      data.role = role;
      const now = new Date("2026-10-28T14:00:00Z");
      data.findMany.mockResolvedValueOnce([
        { id: "still-present", createdAt: now },
        { id: "deleted-after-id-read", createdAt: now },
      ]).mockResolvedValueOnce([{
        id: "still-present", status: "ACTIVE", startDate: now,
        endDate: null, termMonths: 12, reservationExpiresAt: null,
        createdAt: now, customerId: "fixture-customer",
        customer: { companyName: null, user: { name: "Fixture", email: "test@example.test" } },
        serviceAddress: { line1: "Fixture street", city: "Greeley" },
        lines: [], _count: { lines: 0 },
      }]);
      const list = await getRentals({ status: "active", sort: "newest" }, now);
      expect(list.rows.map((row) => row.id)).toEqual(["still-present"]);
      expect(list.rows).not.toContain(undefined);
      expect(data.findMany).toHaveBeenCalledTimes(2);
      expect(list.nextCursor).toBeNull();
    });
  }
});
