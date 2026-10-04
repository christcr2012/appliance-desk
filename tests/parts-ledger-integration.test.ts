import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import {
  archivePartRecord, createPurchaseOrder, markPurchaseOrderOrdered, receivePurchaseOrderLines, recordPartUsage,
  reversePartMovement, updatePartStockSettings, getLowStockParts, getJobPartsUsed,
} from "@/domains/purchasing";
import { deletePartRecord } from "@/domains/inventory";
import {
  applyPartMovementsInTx, findPartLedgerMismatches, InsufficientStockError, jobPartsCost, PartOperationConflictError,
} from "@/domains/purchasing/ledger";

// Parts ledger (Batch C, P1-C) against the real throwaway Postgres. Ledger rows can never be
// deleted, so fixtures are tagged and left in the throwaway database.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/appliance_desk_test";
const key = () => `led-${randomUUID()}`;

describe.skipIf(!enabled)("parts ledger", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string, supplierId: string;
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    supplierId = (await prisma.supplier.create({ data: { name: `Ledger ${tag}` } })).id;
  });
  const newPart = async (qty = 0) => {
    const id = (await prisma.partRecord.create({ data: { modelNumber: `L-${tag}-${randomUUID()}`, partNumber: tag, partName: "Ledger fixture", quantityOnHand: 0 } })).id;
    if (qty > 0) await updatePartStockSettings(ownerId, id, { quantityOnHand: qty, reorderThreshold: null, operationKey: key() });
    return id;
  };
  const stock = async (id: string) => (await prisma.partRecord.findUniqueOrThrow({ where: { id } })).quantityOnHand;
  async function orderedPO(lines: Array<{ partRecordId: string; quantity: number; unitCostCents?: number }>) {
    const po = await createPurchaseOrder(ownerId, { supplierId, lines: lines.map((l) => ({ ...l, description: "Fixture line" })) });
    await markPurchaseOrderOrdered(ownerId, po.id);
    return prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: { orderBy: { id: "asc" } } } });
  }

  it("parts-usage-over-stock-refused-not-clamped", async () => {
    const id = await newPart(2);
    await expect(recordPartUsage(ownerId, id, 5, { operationKey: key() })).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await stock(id)).toBe(2);
    expect(await prisma.partStockMovement.count({ where: { partRecordId: id, kind: "USAGE" } })).toBe(0);
  });

  it("retry-same-key-same-payload-returns-first", async () => {
    const id = await newPart(10);
    const k = key();
    await recordPartUsage(ownerId, id, 3, { operationKey: k });
    await recordPartUsage(ownerId, id, 3, { operationKey: k });
    expect(await stock(id)).toBe(7);
    expect(await prisma.partStockMovement.count({ where: { partRecordId: id, kind: "USAGE" } })).toBe(1);
  });

  it("same-key-different-payload-conflict", async () => {
    const id = await newPart(10);
    const k = key();
    await recordPartUsage(ownerId, id, 3, { operationKey: k });
    await expect(recordPartUsage(ownerId, id, 4, { operationKey: k })).rejects.toBeInstanceOf(PartOperationConflictError);
    expect(await stock(id)).toBe(7);
  });

  it("two-partial-receipts-both-apply", async () => {
    const id = await newPart();
    const po = await orderedPO([{ partRecordId: id, quantity: 10, unitCostCents: 250 }]);
    const lineId = po.lines[0].id;
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId, quantity: 4, unitCostCents: null }] });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("ORDERED");
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId, quantity: 6, unitCostCents: null }] });
    expect(await stock(id)).toBe(10);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
    await expect(receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId, quantity: 1, unitCostCents: null }] })).rejects.toThrow();
  });

  it("a receipt retried with the same key changes nothing twice", async () => {
    const id = await newPart();
    const po = await orderedPO([{ partRecordId: id, quantity: 5, unitCostCents: 100 }]);
    const input = { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: po.lines[0].id, quantity: 2, unitCostCents: null }] };
    await receivePurchaseOrderLines(ownerId, input);
    await expect(receivePurchaseOrderLines(ownerId, input)).resolves.toEqual({ replayed: true });
    expect(await stock(id)).toBe(2);
  });

  it("multi-part-command-locks-sorted-no-deadlock", async () => {
    const [a, b] = [await newPart(20), await newPart(20)];
    const run = (order: string[]) => prisma.$transaction((tx) =>
      applyPartMovementsInTx(tx, ownerId, key(), order.map((partRecordId) => ({ partRecordId, kind: "USAGE" as const, quantityDelta: -1, unitCostCents: null }))));
    await Promise.all(Array.from({ length: 6 }, (_, i) => run(i % 2 ? [a, b] : [b, a])));
    expect(await stock(a)).toBe(14);
    expect(await stock(b)).toBe(14);
  });

  it("opening-balance-not-replayed-from-received-orders", async () => {
    const id = (await prisma.partRecord.create({ data: { modelNumber: `L-${tag}-${randomUUID()}`, partNumber: tag, partName: "Pre-ledger", quantityOnHand: 7 } })).id;
    await prisma.purchaseOrder.create({ data: { supplierId, createdByUserId: ownerId, status: "RECEIVED", lines: { create: { partRecordId: id, description: "Old", quantity: 99, unitCostCents: 1, receivedQuantity: 99 } } } });
    const sql = readFileSync("prisma/migrations/20261003320000_parts_opening_balances/migration.sql", "utf8")
      .replace('FROM "PartRecord" WHERE "quantityOnHand" > 0;', `FROM "PartRecord" WHERE "quantityOnHand" > 0 AND "id" = '${id}';`)
      .replace(/^--.*$/gm, "");
    await prisma.$executeRawUnsafe(sql);
    const rows = await prisma.partStockMovement.findMany({ where: { partRecordId: id } });
    expect(rows.map((r) => [r.kind, r.quantityDelta])).toEqual([["OPENING_BALANCE", 7]]);
    expect(await findPartLedgerMismatches(prisma, [id])).toEqual([]);
  });

  it("stored-total-equals-movement-sum", async () => {
    const id = await newPart();
    const po = await orderedPO([{ partRecordId: id, quantity: 8, unitCostCents: 300 }]);
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: po.lines[0].id, quantity: 8, unitCostCents: null }] });
    await recordPartUsage(ownerId, id, 3, { operationKey: key() });
    await updatePartStockSettings(ownerId, id, { quantityOnHand: 4, reorderThreshold: 2, operationKey: key() });
    const used = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: id, kind: "USAGE" } });
    await reversePartMovement(ownerId, used.id, key());
    const rows = await prisma.partStockMovement.findMany({ where: { partRecordId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(rows.reduce((n, r) => n + r.quantityDelta, 0)).toBe(await stock(id));
    expect(rows.at(-1)!.balanceAfter).toBe(await stock(id));
    expect(await findPartLedgerMismatches(prisma, [id])).toEqual([]);
    await expect(reversePartMovement(ownerId, used.id, key())).rejects.toThrow(/already reversed/);
  });

  it("null-vs-zero-cost", async () => {
    const id = await newPart();
    const po = await orderedPO([{ partRecordId: id, quantity: 2 }, { partRecordId: await newPart(), quantity: 1, unitCostCents: 0 }]);
    const blank = po.lines.find((l) => l.partRecordId === id)!;
    const free = po.lines.find((l) => l.partRecordId !== id)!;
    expect([blank.unitCostKnown, free.unitCostKnown]).toEqual([false, true]);
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [
      { lineId: blank.id, quantity: 2, unitCostCents: null }, { lineId: free.id, quantity: 1, unitCostCents: null },
    ] });
    expect((await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: id } })).unitCostCents).toBeNull();
    expect((await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: free.partRecordId! } })).unitCostCents).toBe(0);
  });

  it("itemized-and-legacy-cost-not-double-counted", async () => {
    const id = await newPart();
    const po = await orderedPO([{ partRecordId: id, quantity: 5, unitCostCents: 400 }]);
    await receivePurchaseOrderLines(ownerId, { purchaseOrderId: po.id, operationKey: key(), lines: [{ lineId: po.lines[0].id, quantity: 5, unitCostCents: null }] });
    const job = await prisma.job.create({ data: { type: "MAINTENANCE_VISIT", status: "SCHEDULED", scheduledAt: new Date("2032-05-01T15:00:00Z"), partsCostCents: 9999 } });
    expect(await jobPartsCost(prisma, job.id)).toMatchObject({ source: "LEGACY", cents: 9999 });
    await recordPartUsage(ownerId, id, 2, { operationKey: key(), jobId: job.id });
    expect(await jobPartsCost(prisma, job.id)).toEqual({ source: "ITEMIZED", cents: 800, unknownCostLines: 0 });
    const used = await getJobPartsUsed(job.id);
    expect(used.cost.cents).toBe(800);
    const movement = await prisma.partStockMovement.findFirstOrThrow({ where: { jobId: job.id } });
    await reversePartMovement(ownerId, movement.id, key());
    expect((await jobPartsCost(prisma, job.id)).cents).toBe(0);
  });

  it("movement-update-delete-blocked-by-trigger", async () => {
    const id = await newPart(3);
    const row = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: id } });
    await expect(prisma.partStockMovement.update({ where: { id: row.id }, data: { quantityDelta: 99 } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(prisma.partStockMovement.delete({ where: { id: row.id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("archive-keeps-history and delete-refused-when-history", async () => {
    const id = await newPart(3);
    await expect(deletePartRecord(ownerId, id)).rejects.toThrow(/Archive it instead/);
    await archivePartRecord(ownerId, id);
    expect((await prisma.partRecord.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
    expect(await prisma.partStockMovement.count({ where: { partRecordId: id } })).toBe(1);
    await expect(recordPartUsage(ownerId, id, 1, { operationKey: key() })).rejects.toThrow(/archived/);
    await prisma.partRecord.update({ where: { id }, data: { reorderThreshold: 10 } });
    expect((await getLowStockParts()).some((p) => p.id === id)).toBe(false);
    const fresh = (await prisma.partRecord.create({ data: { modelNumber: `L-${tag}-${randomUUID()}`, partNumber: tag, partName: "No history" } })).id;
    await expect(deletePartRecord(ownerId, fresh)).resolves.toBeTruthy();
  });
});
