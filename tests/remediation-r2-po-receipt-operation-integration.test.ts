import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { PartOperationConflictError, receivePurchaseOrderLines } from "@/domains/purchasing";
import { prisma } from "@/lib/prisma";

// Stock movements are append-only, so (like the other purchasing tests) the tagged fixtures stay in
// the throwaway test database.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("R16 purchase-order receipts have a durable operation identity", () => {
  const tag = randomUUID();
  let ownerId = "";
  let supplierId = "";
  const key = () => `r16-${randomUUID()}`;

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    supplierId = (await prisma.supplier.create({ data: { name: `R16 ${tag}` } })).id;
  });

  /** An ORDERED order with one stocked line and one free-text (no part) line. */
  async function order(quantity = 10) {
    const part = await prisma.partRecord.create({
      data: { modelNumber: `${tag}-${randomUUID()}`, partNumber: tag, quantityOnHand: 0 },
    });
    const po = await prisma.purchaseOrder.create({
      data: {
        supplierId,
        createdByUserId: ownerId,
        status: "ORDERED",
        lines: {
          create: [
            { partRecordId: part.id, description: "Stocked seal", quantity, unitCostCents: 500, unitCostKnown: true },
            { description: "Free-text washer", quantity, unitCostCents: 0, unitCostKnown: false },
          ],
        },
      },
      include: { lines: true },
    });
    const stocked = po.lines.find((l) => l.partRecordId)!;
    const free = po.lines.find((l) => !l.partRecordId)!;
    return { po, part, stocked, free };
  }
  const received = async (lineId: string) =>
    (await prisma.purchaseOrderLineItem.findUniqueOrThrow({ where: { id: lineId } })).receivedQuantity;
  const claims = (purchaseOrderId: string) => prisma.purchaseOrderReceiptOperation.count({ where: { purchaseOrderId } });

  it("same key and same stocked payload replays without a second effect", async () => {
    const { po, part, stocked } = await order();
    const operationKey = key();
    const lines = [{ lineId: stocked.id, quantity: 3, unitCostCents: null }];
    expect((await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines })).replayed).toBe(false);
    expect((await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines })).replayed).toBe(true);
    expect(await received(stocked.id)).toBe(3);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: part.id } })).quantityOnHand).toBe(3);
    expect(await claims(po.id)).toBe(1);
  });

  it("same key and same free-text payload replays without a second effect", async () => {
    const { po, free } = await order();
    const operationKey = key();
    const lines = [{ lineId: free.id, quantity: 4, unitCostCents: 250 }];
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines });
    const again = await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines });
    expect(again.replayed).toBe(true);
    expect(await received(free.id)).toBe(4);
  });

  it("same key with a different free-text quantity is refused and changes nothing", async () => {
    const { po, free } = await order();
    const operationKey = key();
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [{ lineId: free.id, quantity: 4, unitCostCents: 250 }] });
    await expect(
      receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [{ lineId: free.id, quantity: 5, unitCostCents: 250 }] }),
    ).rejects.toBeInstanceOf(PartOperationConflictError);
    expect(await received(free.id)).toBe(4);
  });

  it("same key with a different price, or price known vs unknown, is refused", async () => {
    const { po, free } = await order();
    const operationKey = key();
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [{ lineId: free.id, quantity: 2, unitCostCents: 250 }] });
    for (const unitCostCents of [300, null]) {
      await expect(
        receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [{ lineId: free.id, quantity: 2, unitCostCents }] }),
      ).rejects.toBeInstanceOf(PartOperationConflictError);
    }
    expect(await received(free.id)).toBe(2);
  });

  it("the order lines can be submitted in any order and still match", async () => {
    const { po, stocked, free } = await order();
    const operationKey = key();
    const a = { lineId: stocked.id, quantity: 1, unitCostCents: null };
    const b = { lineId: free.id, quantity: 1, unitCostCents: null };
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [a, b] });
    expect((await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [b, a] })).replayed).toBe(true);
  });

  it("a new key allows a genuine later partial receipt", async () => {
    const { po, free } = await order();
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: free.id, quantity: 4, unitCostCents: null }] });
    const second = await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: free.id, quantity: 4, unitCostCents: null }] });
    expect(second.replayed).toBe(false);
    expect(await received(free.id)).toBe(8);
  });

  it("a failed receipt leaves no claim, so the corrected retry works", async () => {
    const { po, free } = await order(5);
    const operationKey = key();
    await expect(
      receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [{ lineId: free.id, quantity: 99, unitCostCents: null }] }),
    ).rejects.toThrow(/still to arrive/);
    expect(await claims(po.id)).toBe(0);
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines: [{ lineId: free.id, quantity: 2, unitCostCents: null }] });
    expect(await received(free.id)).toBe(2);
  });

  it("the same key on a different order is refused", async () => {
    const one = await order();
    const two = await order();
    const operationKey = key();
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: one.po.id, operationKey, lines: [{ lineId: one.free.id, quantity: 1, unitCostCents: null }] });
    await expect(
      receivePurchaseOrderLines(ownerId, { purchaseOrderId: two.po.id, operationKey, lines: [{ lineId: two.free.id, quantity: 1, unitCostCents: null }] }),
    ).rejects.toBeInstanceOf(PartOperationConflictError);
  });

  it("concurrent identical requests produce one receipt effect", async () => {
    const { po, part, stocked, free } = await order();
    const operationKey = key();
    const lines = [
      { lineId: stocked.id, quantity: 2, unitCostCents: null },
      { lineId: free.id, quantity: 2, unitCostCents: null },
    ];
    const results = await Promise.allSettled([
      receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines }),
      receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines }),
      receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey, lines }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled" && !r.value.replayed)).toHaveLength(1);
    expect(await received(stocked.id)).toBe(2);
    expect(await received(free.id)).toBe(2);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id: part.id } })).quantityOnHand).toBe(2);
    expect(await claims(po.id)).toBe(1);
  });
});
