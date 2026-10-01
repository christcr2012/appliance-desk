import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cancelPurchaseOrder, receivePurchaseOrder, recordPartUsage } from "@/domains/purchasing";
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("purchasing stock concurrency", () => {
  const tag = randomUUID();
  let ownerId: string, supplierId: string, partId: string;
  const orders: string[] = [];
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    supplierId = (await prisma.supplier.create({ data: { name: `Stock fixture ${tag}` } })).id;
    partId = (await prisma.partRecord.create({ data: { modelNumber: tag, partNumber: tag, partName: "Stock fixture", quantityOnHand: 0 } })).id;
  });
  beforeEach(async () => { await prisma.partRecord.update({ where: { id: partId }, data: { quantityOnHand: 0 } }); });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...orders, partId] } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orders } } });
    await prisma.partRecord.deleteMany({ where: { id: partId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
  });
  async function order() {
    const row = await prisma.purchaseOrder.create({ data: {
      supplierId, createdByUserId: ownerId, status: "ORDERED",
      lines: { create: { partRecordId: partId, description: "Door seals", quantity: 4, unitCostCents: 500 } },
    } });
    orders.push(row.id); return row.id;
  }
  it("receiving the same order concurrently adds each line once", async () => {
    const id = await order();
    const results = await Promise.allSettled([receivePurchaseOrder(ownerId, id), receivePurchaseOrder(ownerId, id)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(4);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "purchase_order.receive" } })).toBe(1);
  });
  it("an audit failure rolls back status and stock, allowing a safe retry", async () => {
    const id = await order();
    await expect(receivePurchaseOrder(`missing-${tag}`, id)).rejects.toThrow();
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status).toBe("ORDERED");
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(0);
    await receivePurchaseOrder(ownerId, id);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(4);
  });
  it("cancellation and receiving cannot both commit", async () => {
    const id = await order();
    const results = await Promise.allSettled([receivePurchaseOrder(ownerId, id), cancelPurchaseOrder(ownerId, id)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const state = (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
    expect(["RECEIVED", "CANCELLED"]).toContain(state);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(state === "RECEIVED" ? 4 : 0);
  });
  it("simultaneous usages both subtract, clamp to zero and roll back on audit failure", async () => {
    await prisma.partRecord.update({ where: { id: partId }, data: { quantityOnHand: 10 } });
    await Promise.all([recordPartUsage(ownerId, partId, 2), recordPartUsage(ownerId, partId, 3)]);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(5);
    await expect(recordPartUsage(`missing-${tag}`, partId, 2)).rejects.toThrow();
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(5);
    await Promise.all([recordPartUsage(ownerId, partId, 4), recordPartUsage(ownerId, partId, 4)]);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: partId } })).quantityOnHand).toBe(0);
  });
});
