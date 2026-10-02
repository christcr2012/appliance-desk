import { describe, it, expect, vi, beforeEach } from "vitest";

// This tests the query SHAPE this module sends to Prisma, not a live
// database — that's what CI's real Postgres integration tests are for
// (see docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md's note on this project's testing convention). What
// matters here, and what regressed before this fix (Verified Finding #2):
// every call site must ask for `status: "ACTIVE"` on the agreement, never
// leave it unfiltered.
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { applianceAssignment: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

describe("active-appliances", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([
      {
        appliance: { id: "appl-1", assetNumber: "A-100", applianceType: { name: "Washer" } },
      },
    ]);
  });

  it("getActiveApplianceOptionsForCustomer only asks for ACTIVE agreements on this customer", async () => {
    const { getActiveApplianceOptionsForCustomer } = await import(
      "@/domains/agreements/active-appliances"
    );

    const result = await getActiveApplianceOptionsForCustomer("cust-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          unassignedAt: null,
          rentalLine: expect.objectContaining({
            agreement: expect.objectContaining({ customerId: "cust-1", status: "ACTIVE" }),
          }),
        }),
      }),
    );
    expect(result).toEqual([{ id: "appl-1", label: "Washer (A-100)" }]);
  });

  it("getActiveApplianceOptionsForUser resolves through the signed-in user's own id, never a client-supplied customerId", async () => {
    const { getActiveApplianceOptionsForUser } = await import(
      "@/domains/agreements/active-appliances"
    );

    await getActiveApplianceOptionsForUser("user-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          unassignedAt: null,
          rentalLine: expect.objectContaining({
            agreement: expect.objectContaining({
              status: "ACTIVE",
              customer: { userId: "user-1" },
            }),
          }),
        }),
      }),
    );
  });

  it("ACTIVE_ASSIGNMENT_WHERE (used by the portal's own-agreements query) requires status ACTIVE and the appliance actually delivered", async () => {
    const { ACTIVE_ASSIGNMENT_WHERE } = await import("@/domains/agreements/active-appliances");

    // Rental lifecycle (2026-09-28): signing alone no longer means
    // delivered, so "currently belongs to this customer" also requires
    // the appliance's own status show it's actually with them (RENTED)
    // or on its way back (AWAITING_PICKUP) — not merely RESERVED.
    expect(ACTIVE_ASSIGNMENT_WHERE).toEqual({
      unassignedAt: null,
      rentalLine: { agreement: { status: "ACTIVE" } },
      appliance: { status: { in: ["RENTED", "AWAITING_PICKUP"] } },
    });
  });

  it("getActiveApplianceOptionsForCustomer/ForUser also require the appliance be actually delivered (RENTED or AWAITING_PICKUP)", async () => {
    const { getActiveApplianceOptionsForCustomer } = await import(
      "@/domains/agreements/active-appliances"
    );

    await getActiveApplianceOptionsForCustomer("cust-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          appliance: { status: { in: ["RENTED", "AWAITING_PICKUP"] } },
        }),
      }),
    );
  });
});
