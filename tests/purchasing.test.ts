import { describe, it, expect, vi, beforeEach } from "vitest";

// Purchasing & supplies (2026-09-29) — src/domains/purchasing. Mocked-
// prisma unit tests (same pattern as
// tests/agreements-prepay-discount.test.ts) for the wiring and
// guardrails that don't need a real database to prove: validation on
// creating a purchase order, the status guards on
// ordered/received/cancelled, and getLowStockParts' filter.

const purchaseOrderCreate = vi.fn();
const purchaseOrderFindUniqueOrThrow = vi.fn();
const purchaseOrderUpdate = vi.fn();
const purchaseOrderClaim = vi.fn();
const lockPart = vi.fn();
const supplierFindUnique = vi.fn();
const partRecordUpdate = vi.fn();
const partRecordFindUniqueOrThrow = vi.fn();
const partRecordFindMany = vi.fn();
const auditLogCreate = vi.fn();

const partRecordCount = vi.fn();
function makeTx() {
  return {
    $queryRaw: lockPart,
    partRecord: { findUniqueOrThrow: partRecordFindUniqueOrThrow, update: (...args: unknown[]) => partRecordUpdate(...args), count: (...args: unknown[]) => partRecordCount(...args) },
    purchaseOrder: { create: (...args: unknown[]) => purchaseOrderCreate(...args), findUniqueOrThrow: purchaseOrderFindUniqueOrThrow, updateMany: purchaseOrderClaim, update: (...args: unknown[]) => purchaseOrderUpdate(...args) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    purchaseOrder: {
      create: (...args: unknown[]) => purchaseOrderCreate(...args),
      findUniqueOrThrow: (...args: unknown[]) => purchaseOrderFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => purchaseOrderUpdate(...args),
    },
    partRecord: {
      update: (...args: unknown[]) => partRecordUpdate(...args),
      findUniqueOrThrow: (...args: unknown[]) => partRecordFindUniqueOrThrow(...args),
      findMany: (...args: unknown[]) => partRecordFindMany(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    supplier: { findUnique: (...args: unknown[]) => supplierFindUnique(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

import {
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  cancelPurchaseOrder,
  recordPartUsage,
  getLowStockParts,
} from "@/domains/purchasing";

beforeEach(() => {
  purchaseOrderClaim.mockReset().mockResolvedValue({ count: 1 });
  lockPart.mockReset().mockResolvedValue([]);
  supplierFindUnique.mockReset().mockResolvedValue({ archivedAt: null });
  purchaseOrderCreate.mockReset();
  purchaseOrderFindUniqueOrThrow.mockReset();
  purchaseOrderUpdate.mockReset().mockResolvedValue({});
  partRecordUpdate.mockReset().mockResolvedValue({});
  partRecordCount.mockReset().mockResolvedValue(0);
  partRecordFindUniqueOrThrow.mockReset();
  partRecordFindMany.mockReset();
  auditLogCreate.mockReset().mockResolvedValue({});
});

describe("createPurchaseOrder", () => {
  it("rejects a purchase order with no lines", async () => {
    await expect(createPurchaseOrder("user-1", { supplierId: "sup-1", lines: [] })).rejects.toThrow(
      /at least one line/,
    );
    expect(purchaseOrderCreate).not.toHaveBeenCalled();
  });

  it("rejects a line with a blank description", async () => {
    await expect(
      createPurchaseOrder("user-1", {
        supplierId: "sup-1",
        lines: [{ description: "  ", quantity: 1 }],
      }),
    ).rejects.toThrow(/description/);
  });

  it("rejects a line with quantity below 1", async () => {
    await expect(
      createPurchaseOrder("user-1", {
        supplierId: "sup-1",
        lines: [{ description: "Door seal", quantity: 0 }],
      }),
    ).rejects.toThrow(/Quantity must be at least 1/);
  });

  it("refuses an archived supplier", async () => {
    supplierFindUnique.mockResolvedValue({ archivedAt: new Date() });
    await expect(
      createPurchaseOrder("user-1", { supplierId: "sup-1", lines: [{ description: "Door seal", quantity: 1 }] }),
    ).rejects.toThrow(/archived/);
    expect(purchaseOrderCreate).not.toHaveBeenCalled();
  });

  it("refuses a part that has been archived, even from a stale form", async () => {
    lockPart.mockResolvedValue([{ id: "part-1" }]);
    partRecordCount.mockResolvedValue(1);
    await expect(
      createPurchaseOrder("user-1", { supplierId: "sup-1", lines: [{ partRecordId: "part-1", description: "Seal", quantity: 1 }] }),
    ).rejects.toThrow(/archived/);
    expect(purchaseOrderCreate).not.toHaveBeenCalled();
  });

  it("stores a blank price as unknown, and a typed 0 as a known zero", async () => {
    purchaseOrderCreate.mockResolvedValue({ id: "po-2" });
    await createPurchaseOrder("user-1", {
      supplierId: "sup-1",
      lines: [{ description: "Unknown", quantity: 1 }, { description: "Free", quantity: 1, unitCostCents: 0 }],
    });
    const rows = purchaseOrderCreate.mock.calls[0][0].data.lines.createMany.data;
    expect(rows.map((r: { unitCostKnown: boolean }) => r.unitCostKnown)).toEqual([false, true]);
  });

  it("creates the order with its lines when valid", async () => {
    purchaseOrderCreate.mockResolvedValue({ id: "po-1" });
    const order = await createPurchaseOrder("user-1", {
      supplierId: "sup-1",
      lines: [{ description: "Door seal", quantity: 2, unitCostCents: 1500 }],
    });
    expect(order.id).toBe("po-1");
    expect(purchaseOrderCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
  });
});

describe("markPurchaseOrderOrdered", () => {
  it("throws if the order isn't DRAFT", async () => {
    purchaseOrderClaim.mockResolvedValueOnce({ count: 0 });
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({ id: "po-1", status: "ORDERED" });
    await expect(markPurchaseOrderOrdered("user-1", "po-1")).rejects.toThrow(/draft/);
    expect(purchaseOrderUpdate).not.toHaveBeenCalled();
  });

  it("moves a DRAFT order to ORDERED", async () => {
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({ id: "po-1", status: "DRAFT" });
    await markPurchaseOrderOrdered("user-1", "po-1");
    expect(purchaseOrderClaim).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ORDERED" }) }),
    );
  });
});

describe("cancelPurchaseOrder", () => {
  it("throws if the order is already RECEIVED", async () => {
    purchaseOrderClaim.mockResolvedValueOnce({ count: 0 });
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({ id: "po-1", status: "RECEIVED" });
    await expect(cancelPurchaseOrder("user-1", "po-1")).rejects.toThrow(/can't be cancelled/);
  });

  it("throws if the order is already CANCELLED", async () => {
    purchaseOrderClaim.mockResolvedValueOnce({ count: 0 });
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({ id: "po-1", status: "CANCELLED" });
    await expect(cancelPurchaseOrder("user-1", "po-1")).rejects.toThrow(/can't be cancelled/);
  });

  it("cancels a DRAFT or ORDERED order", async () => {
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({ id: "po-1", status: "ORDERED" });
    await cancelPurchaseOrder("user-1", "po-1");
    expect(purchaseOrderClaim).toHaveBeenCalledWith({
      where: { id: "po-1", status: { in: ["DRAFT", "ORDERED"] } },
      data: { status: "CANCELLED" },
    });
  });
});

describe("recordPartUsage input checks", () => {
  it("rejects a quantity that is not a whole number of at least 1, before touching the database", async () => {
    for (const amount of [0, -1, 1.5, NaN, Infinity]) {
      await expect(recordPartUsage("user-1", "part-1", amount, { operationKey: "usage-key-0001" })).rejects.toThrow(/how many/);
    }
    expect(partRecordUpdate).not.toHaveBeenCalled();
  });
});

describe("getLowStockParts", () => {
  it("only returns parts with a threshold set and at or below it", async () => {
    partRecordFindMany.mockResolvedValue([
      { id: "p1", quantityOnHand: 1, reorderThreshold: 5 }, // low
      { id: "p2", quantityOnHand: 10, reorderThreshold: 5 }, // fine
      { id: "p3", quantityOnHand: 5, reorderThreshold: 5 }, // exactly at threshold — still flagged
    ]);

    const result = await getLowStockParts();

    expect(result.map((p) => p.id).sort()).toEqual(["p1", "p3"]);
    // The query itself should already exclude parts with no threshold —
    // proving the where clause, not just the in-memory filter.
    expect(partRecordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reorderThreshold: { not: null }, archivedAt: null } }),
    );
  });
});

