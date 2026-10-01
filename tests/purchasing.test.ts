import { describe, it, expect, vi, beforeEach } from "vitest";

// Purchasing & supplies (2026-09-29) — src/domains/purchasing. Mocked-
// prisma unit tests (same pattern as
// tests/agreements-prepay-discount.test.ts) for the wiring and
// guardrails that don't need a real database to prove: validation on
// creating a purchase order, the status guards on
// ordered/received/cancelled, receiving actually incrementing stock,
// recordPartUsage's clamp-at-zero, and getLowStockParts' filter.

const purchaseOrderCreate = vi.fn();
const purchaseOrderFindUniqueOrThrow = vi.fn();
const purchaseOrderUpdate = vi.fn();
const purchaseOrderClaim = vi.fn();
const lockPart = vi.fn();
const partRecordUpdate = vi.fn();
const partRecordFindUniqueOrThrow = vi.fn();
const partRecordFindMany = vi.fn();
const auditLogCreate = vi.fn();

function makeTx() {
  return {
    $queryRaw: lockPart,
    partRecord: { findUniqueOrThrow: partRecordFindUniqueOrThrow, update: (...args: unknown[]) => partRecordUpdate(...args) },
    purchaseOrder: { findUniqueOrThrow: purchaseOrderFindUniqueOrThrow, updateMany: purchaseOrderClaim, update: (...args: unknown[]) => purchaseOrderUpdate(...args) },
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
    $transaction: async (fn: (tx: unknown) => unknown) => fn(makeTx()),
  },
}));

import {
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  recordPartUsage,
  getLowStockParts,
} from "@/domains/purchasing";

beforeEach(() => {
  purchaseOrderClaim.mockReset().mockResolvedValue({ count: 1 });
  lockPart.mockReset().mockResolvedValue([]);
  purchaseOrderCreate.mockReset();
  purchaseOrderFindUniqueOrThrow.mockReset();
  purchaseOrderUpdate.mockReset().mockResolvedValue({});
  partRecordUpdate.mockReset().mockResolvedValue({});
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

describe("receivePurchaseOrder", () => {
  it("throws if the order isn't ORDERED", async () => {
    purchaseOrderClaim.mockResolvedValueOnce({ count: 0 });
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({ id: "po-1", status: "DRAFT", lines: [] });
    await expect(receivePurchaseOrder("user-1", "po-1")).rejects.toThrow(/ordered/);
    expect(partRecordUpdate).not.toHaveBeenCalled();
  });

  it("increments quantityOnHand for every line tied to a real part, skipping free-text lines", async () => {
    purchaseOrderFindUniqueOrThrow.mockResolvedValue({
      id: "po-1",
      status: "ORDERED",
      lines: [
        { id: "line-1", partRecordId: "part-1", quantity: 5, description: "Door seal" },
        { id: "line-2", partRecordId: null, quantity: 1, description: "Bulk mobilization fee" },
      ],
    });

    await receivePurchaseOrder("user-1", "po-1");

    expect(partRecordUpdate).toHaveBeenCalledTimes(1);
    expect(partRecordUpdate).toHaveBeenCalledWith({
      where: { id: "part-1" },
      data: { quantityOnHand: { increment: 5 } },
    });
    expect(purchaseOrderClaim).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RECEIVED" }) }),
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

describe("recordPartUsage", () => {
  it("rejects a quantity below 1", async () => {
    await expect(recordPartUsage("user-1", "part-1", 0)).rejects.toThrow(/how many/);
  });

  it("subtracts the used quantity from what's on hand", async () => {
    partRecordFindUniqueOrThrow.mockResolvedValue({ id: "part-1", quantityOnHand: 10 });
    await recordPartUsage("user-1", "part-1", 3);
    expect(partRecordUpdate).toHaveBeenCalledWith({
      where: { id: "part-1" },
      data: { quantityOnHand: 7 },
    });
  });

  it("clamps at 0 rather than going negative when more is used than is on hand", async () => {
    partRecordFindUniqueOrThrow.mockResolvedValue({ id: "part-1", quantityOnHand: 2 });
    await recordPartUsage("user-1", "part-1", 5);
    expect(partRecordUpdate).toHaveBeenCalledWith({
      where: { id: "part-1" },
      data: { quantityOnHand: 0 },
    });
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
      expect.objectContaining({ where: { reorderThreshold: { not: null } } }),
    );
  });
});

it("failed receiving claims cannot increment stock or audit", async () => {
  purchaseOrderClaim.mockResolvedValueOnce({ count: 0 });
  await expect(receivePurchaseOrder("user-1", "po-1")).rejects.toThrow(/ordered/);
  expect(partRecordUpdate).not.toHaveBeenCalled();
  expect(auditLogCreate).not.toHaveBeenCalled();
});
it("locks part stock before reading and does not accept fractional/invalid usage", async () => {
  partRecordFindUniqueOrThrow.mockResolvedValue({ quantityOnHand: 5 });
  await recordPartUsage("user-1", "part-1", 2);
  expect(lockPart.mock.invocationCallOrder[0]).toBeLessThan(partRecordFindUniqueOrThrow.mock.invocationCallOrder[0]);
  for (const amount of [1.5, NaN, Infinity]) await expect(recordPartUsage("user-1", "part-1", amount)).rejects.toThrow();
});
