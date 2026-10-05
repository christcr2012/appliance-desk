import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  part: vi.fn(),
  movements: vi.fn(),
  users: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    partRecord: { findUnique: mocks.part },
    partStockMovement: { findMany: mocks.movements },
    user: { findMany: mocks.users },
  },
}));

import { getPartMovementHistory } from "@/domains/inventory/part-history";

describe("part stock movement history", () => {
  beforeEach(() => {
    mocks.requireRole.mockReset().mockResolvedValue({ user: { id: "staff-1", role: "STAFF" } });
    mocks.part.mockReset().mockResolvedValue({
      id: "part-1",
      modelNumber: "M1",
      manufacturer: "Maker",
      partNumber: "P1",
      partName: "Pump",
      quantityOnHand: 8,
      archivedAt: null,
      applianceType: { name: "Washer" },
    });
    mocks.users.mockReset().mockResolvedValue([{ id: "owner-1", name: "Chris", email: "owner@example.test" }]);
  });

  it("uses stable newest-first pagination, fetches only one lookahead row, and omits unit cost", async () => {
    mocks.movements.mockResolvedValue(
      Array.from({ length: 26 }, (_, index) => ({
        id: `movement-${index}`,
        kind: "RECEIPT",
        quantityDelta: 1,
        balanceAfter: 8 - index,
        reason: null,
        createdByUserId: "owner-1",
        createdAt: new Date(2026, 9, 5, 12, index),
        job: null,
        purchaseOrderLineItem: null,
      })),
    );

    const result = await getPartMovementHistory("part-1", 2);

    expect(mocks.requireRole).toHaveBeenCalledWith("OWNER", "ADMIN", "STAFF");
    expect(mocks.movements).toHaveBeenCalledWith(expect.objectContaining({
      where: { partRecordId: "part-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 25,
      take: 26,
    }));
    const call = mocks.movements.mock.calls[0][0];
    expect(call.select).not.toHaveProperty("unitCostCents");
    expect(result?.movements).toHaveLength(25);
    expect(result?.hasMore).toBe(true);
    expect(result?.movements[0].actorLabel).toBe("Chris");
  });

  it("returns null for an unknown part", async () => {
    mocks.part.mockResolvedValue(null);
    await expect(getPartMovementHistory("missing", 1)).resolves.toBeNull();
    expect(mocks.movements).not.toHaveBeenCalled();
  });
});
