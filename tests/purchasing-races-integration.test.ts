import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cancelPurchaseOrder, receivePurchaseOrder, recordPartUsage } from "@/domains/purchasing";
import { findPartLedgerMismatches, InsufficientStockError } from "@/domains/purchasing/ledger";

// Real-Postgres checks for stock changes that happen at the same moment. Parts that have ledger
// rows can never be deleted (history is permanent), so every fixture is tagged and left behind in
// the throwaway test database; each test starts the part from a known balance with its own rows.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `race-${randomUUID()}`;

describe.skipIf(!enabled)("purchasing stock concurrency", () => {
  const tag = randomUUID();
  let ownerId: string, supplierId: string;
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    supplierId = (await prisma.supplier.create({ data: { name: `Stock fixture ${tag}` } })).id;
  });
  let partId: string;
  beforeEach(async () => {
    partId = (await prisma.partRecord.create({ data: { modelNumber: `${tag}-${randomUUID()}`, partNumber: tag, partName: "Stock fixture", quantityOnHand: 0 } })).id;
  });
  async function order() {
    const row = await prisma.purchaseOrder.create({ data: {
      supplierId, createdByUserId: ownerId, status: "ORDERED",
      lines: { create: { partRecordId: partId, description: "Door seals", quantity: 4, unitCostCents: 500, unitCostKnown: true } },
    } });
    return row.id;
  }
  async function stock() { return (await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand; }
  async function stockUp(n: number) { await recordPartUsageSetup(n); }
  async function recordPartUsageSetup(n: number) {
    const { updatePartStockSettings } = await import("@/domains/purchasing");
    await updatePartStockSettings(ownerId, partId, { quantityOnHand: n, reorderThreshold: null, operationKey: key() });
  }

  it("receiving the same order concurrently adds each line once", async () => {
    const id = await order();
    await Promise.allSettled([receivePurchaseOrder(ownerId, id), receivePurchaseOrder(ownerId, id)]);
    expect(await stock()).toBe(4);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "purchase_order.receive" } })).toBe(1);
    expect(await findPartLedgerMismatches(prisma, [partId])).toEqual([]);
  });

  it("an audit failure rolls back status and stock, allowing a safe retry", async () => {
    const id = await order();
    await expect(receivePurchaseOrder(`missing-${tag}`, id)).rejects.toThrow();
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status).toBe("ORDERED");
    expect(await stock()).toBe(0);
    await receivePurchaseOrder(ownerId, id);
    expect(await stock()).toBe(4);
  });

  it("cancellation and receiving cannot both commit", async () => {
    const id = await order();
    const results = await Promise.allSettled([receivePurchaseOrder(ownerId, id), cancelPurchaseOrder(ownerId, id)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const state = (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
    expect(["RECEIVED", "CANCELLED"]).toContain(state);
    expect(await stock()).toBe(state === "RECEIVED" ? 4 : 0);
  });

  it("simultaneous usages both subtract; using more than is on hand is refused, not floored", async () => {
    await stockUp(10);
    await Promise.all([
      recordPartUsage(ownerId, partId, 2, { operationKey: key() }),
      recordPartUsage(ownerId, partId, 3, { operationKey: key() }),
    ]);
    expect(await stock()).toBe(5);
    await expect(recordPartUsage(`missing-${tag}`, partId, 2, { operationKey: key() })).rejects.toThrow();
    expect(await stock()).toBe(5);
    const results = await Promise.allSettled([
      recordPartUsage(ownerId, partId, 4, { operationKey: key() }),
      recordPartUsage(ownerId, partId, 4, { operationKey: key() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(InsufficientStockError);
    expect(await stock()).toBe(1);
    expect(await findPartLedgerMismatches(prisma, [partId])).toEqual([]);
  });

  it("a retried stock-settings save does not undo a later one and a reused key with different values is refused", async () => {
    const { updatePartStockSettings } = await import("@/domains/purchasing");
    const { PartOperationConflictError } = await import("@/domains/purchasing/ledger");
    const first = key();
    await updatePartStockSettings(ownerId, partId, { quantityOnHand: 5, reorderThreshold: 2, operationKey: first });
    await updatePartStockSettings(ownerId, partId, { quantityOnHand: 5, reorderThreshold: 7, operationKey: key() });
    await updatePartStockSettings(ownerId, partId, { quantityOnHand: 5, reorderThreshold: 2, operationKey: first });
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).reorderThreshold).toBe(7);
    await expect(updatePartStockSettings(ownerId, partId, { quantityOnHand: 5, reorderThreshold: 3, operationKey: first })).rejects.toBeInstanceOf(PartOperationConflictError);
  });

  it("a usage retry still replays after a later receipt changed the last known cost", async () => {
    const u = key();
    await stockUp(10);
    const id = await order();
    await recordPartUsage(ownerId, partId, 1, { operationKey: u });
    await receivePurchaseOrder(ownerId, id);
    await expect(recordPartUsage(ownerId, partId, 1, { operationKey: u })).resolves.toBeDefined();
    expect(await stock()).toBe(13);
  });

  it("the rest of a part-way received line cannot be entered at a different price; new orders refuse archived parts", async () => {
    const { receivePurchaseOrderLines, createPurchaseOrder } = await import("@/domains/purchasing");
    const id = await order();
    const line = await prisma.purchaseOrderLineItem.findFirstOrThrow({ where: { purchaseOrderId: id } });
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: id, operationKey: key(), lines: [{ lineId: line.id, quantity: 1, unitCostCents: null }] });
    await expect(receivePurchaseOrderLines(ownerId, { purchaseOrderId: id, operationKey: key(), lines: [{ lineId: line.id, quantity: 1, unitCostCents: 900 }] })).rejects.toThrow(/already arrived/);
    await prisma.partRecord.update({ where: { id: partId }, data: { archivedAt: new Date() } });
    await expect(createPurchaseOrder(ownerId, { supplierId, lines: [{ partRecordId: partId, description: "x", quantity: 1 }] })).rejects.toThrow(/archived/);
  });
});
