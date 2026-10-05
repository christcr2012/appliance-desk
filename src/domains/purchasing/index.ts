import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  applyPartMovementsInTx,
  lastKnownPurchaseCostCents,
  lockPartRecords,
  OPERATION_KEY_PATTERN,
  type PartMovementRequest,
} from "./ledger";

export {
  InsufficientStockError,
  PartOperationConflictError,
  applyPartMovementsInTx,
  findPartLedgerMismatches,
  jobPartsCost,
  jobPartsCosts,
} from "./ledger";
import { jobPartsCost, PartOperationConflictError } from "./ledger";

// ---------------------------------------------------------------------------
// Purchasing & supplies (2026-09-29) — see docs/BUSINESS-RULES.md's
// "Purchasing & supplies" section. Deliberately minimal: a Supplier is
// just contact info, a PurchaseOrder moves DRAFT → ORDERED → RECEIVED
// (or CANCELLED at any point before RECEIVED). Since Batch C (2026-10-03)
// every change to a part's stock is a row in the parts ledger
// (./ledger.ts); a purchase order can be received in several partial
// shipments; using more than is on hand is refused. There's no purchasing
// approval workflow and no automatic consumption tracking (a part used on
// a repair only leaves stock when Chris says so, via recordPartUsage).
// ---------------------------------------------------------------------------

export type NewSupplierInput = {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export async function getSuppliers(options: { includeArchived?: boolean } = {}) {
  return prisma.supplier.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    include: { _count: { select: { purchaseOrders: true } } },
    orderBy: [{ name: "asc" }],
  });
}

export async function getSupplierById(id: string) {
  return prisma.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: {
        orderBy: [{ createdAt: "desc" }],
        include: { lines: true },
      },
    },
  });
}

export async function createSupplier(input: NewSupplierInput) {
  if (!input.name.trim()) {
    throw new Error("Enter a supplier name.");
  }
  return prisma.supplier.create({
    data: {
      name: input.name.trim(),
      contactName: input.contactName?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function updateSupplier(supplierId: string, input: NewSupplierInput) {
  if (!input.name.trim()) {
    throw new Error("Enter a supplier name.");
  }
  return prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name: input.name.trim(),
      contactName: input.contactName?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });
}

export type NewPurchaseOrderLineInput = {
  partRecordId?: string | null;
  description: string;
  quantity: number;
  unitCostCents?: number;
};

export type NewPurchaseOrderInput = {
  supplierId: string;
  notes?: string;
  lines: NewPurchaseOrderLineInput[];
};

export async function createPurchaseOrder(userId: string, input: NewPurchaseOrderInput) {
  if (input.lines.length === 0) {
    throw new Error("Add at least one line to this purchase order.");
  }
  for (const line of input.lines) {
    if (!line.description.trim()) {
      throw new Error("Every line needs a description.");
    }
    if (line.quantity < 1) {
      throw new Error("Quantity must be at least 1 for every line.");
    }
  }

  // R14: the actor check, supplier check, part checks, the order and its audit entry are one
  // transaction. Lock order is supplier, then parts (sorted by id); archiving a supplier updates
  // its row, which waits on the shared lock taken here, so an archive and an order cannot interleave.
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const locked = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
      SELECT "archivedAt" FROM "Supplier" WHERE "id" = ${input.supplierId} FOR SHARE
    `;
    if (locked.length !== 1) throw new Error("Choose a supplier.");
    if (locked[0]!.archivedAt) throw new Error("This supplier is archived. Restore it before placing a new order.");

    const partIds = [...new Set(input.lines.flatMap((l) => l.partRecordId || []))];
    await lockPartRecords(tx, partIds);
    if (partIds.length > 0 && (await tx.partRecord.count({ where: { id: { in: partIds }, archivedAt: { not: null } } })) > 0) {
      throw new Error("One of those parts is archived. Restore it before ordering more.");
    }
    const order = await tx.purchaseOrder.create({
      data: {
        supplierId: input.supplierId,
        notes: input.notes?.trim() || null,
        createdByUserId: userId,
        lines: {
          createMany: {
            data: input.lines.map((line) => ({
              partRecordId: line.partRecordId || null,
              description: line.description.trim(),
              quantity: line.quantity,
              unitCostCents: line.unitCostCents ?? 0,
              unitCostKnown: line.unitCostCents !== undefined && line.unitCostCents !== null,
            })),
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "purchase_order.create",
        entityType: "PurchaseOrder",
        entityId: order.id,
        newValue: { supplierId: input.supplierId, lineCount: input.lines.length },
      },
    });
    return order;
  });
}

export async function getPurchaseOrders() {
  return prisma.purchaseOrder.findMany({
    include: { supplier: true, lines: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getPurchaseOrderById(id: string) {
  return prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { include: { partRecord: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
}

/** Marks a DRAFT purchase order as actually placed with the supplier —
 * a record-keeping step (Chris still places the real order himself, by
 * phone/email/website, same as everything else this app doesn't
 * automate on his behalf) rather than anything that talks to a
 * supplier's system. */
export async function markPurchaseOrderOrdered(userId: string, purchaseOrderId: string) {
  return prisma.$transaction(async tx => {
    const claim = await tx.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, status: "DRAFT" },
      data: { status: "ORDERED", orderedAt: new Date() },
    });
    if (claim.count !== 1) throw new Error("Only a draft purchase order can be marked as ordered.");
    await tx.auditLog.create({ data: {
      userId, action: "purchase_order.order", entityType: "PurchaseOrder", entityId: purchaseOrderId,
    } });
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
  });
}

export type ReceiveLinesInput = {
  purchaseOrderId: string;
  /** A random id the screen creates when the form opens; a retry with the same id changes nothing. */
  operationKey: string;
  lines: { lineId: string; quantity: number; unitCostCents: number | null }[];
};

/**
 * Receives some or all of an ORDERED purchase order. Each line can arrive in several shipments:
 * a quantity may not exceed what is still outstanding on the line, the order becomes RECEIVED only
 * when every line is complete, and a cancelled order keeps the stock already received. Lines tied to
 * a part add a RECEIPT movement to the ledger; free-text lines only count their received quantity.
 * A retry with the same operationKey returns the first result and changes nothing; a second real
 * partial receipt uses a new key.
 */
export async function receivePurchaseOrderLines(userId: string, input: ReceiveLinesInput): Promise<{ replayed: boolean }> {
  if (!OPERATION_KEY_PATTERN.test(input.operationKey) || input.operationKey.length > 70) {
    throw new Error("This request has no valid identity. Reload the page and try again.");
  }
  if (input.lines.length === 0) throw new Error("Enter how many arrived on at least one line.");
  const lineIds = input.lines.map((l) => l.lineId);
  if (new Set(lineIds).size !== lineIds.length) throw new Error("A line can appear only once in one receipt.");

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${input.purchaseOrderId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Couldn't find that purchase order.");
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: input.purchaseOrderId },
      include: { lines: { orderBy: [{ id: "asc" }] } },
    });

    // A retry of a receipt that already applied returns the first result, even if the order has since been completed.
    const prior = await tx.partStockMovement.findFirst({
      where: { purchaseOrderLineItem: { purchaseOrderId: order.id }, operationKey: { startsWith: `${input.operationKey}:` } },
      select: { id: true },
    });
    const priorAny = prior ?? (await tx.auditLog.findFirst({ where: { action: "purchase_order.receive", entityId: order.id, newValue: { path: ["operationKey"], equals: input.operationKey } }, select: { id: true } }));
    if (priorAny) {
      await replayLineMovements(tx, userId, order.lines, input);
      return { replayed: true };
    }

    if (order.status !== "ORDERED") throw new Error("Only a purchase order that's been marked as ordered can be received.");

    const byId = new Map(order.lines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      const row = byId.get(line.lineId);
      if (!row) throw new Error("One of those lines is not on this purchase order.");
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error("A received quantity must be at least 1.");
      const outstanding = row.quantity - row.receivedQuantity;
      if (line.quantity > outstanding) {
        throw new Error(`Only ${outstanding} still to arrive on “${row.description}”.`);
      }
      if (row.receivedQuantity > 0 && line.unitCostCents !== null && !(row.unitCostKnown && row.unitCostCents === line.unitCostCents)) {
        throw new Error(`Part of “${row.description}” already arrived at ${row.unitCostKnown ? `${(row.unitCostCents / 100).toFixed(2)} each` : "an unknown price"}. Leave the price blank for the rest, or correct the earlier receipt first, so the order total stays true.`);
      }
    }

    // Lock every part this receipt touches, sorted by id, before writing anything.
    await lockPartRecords(tx, input.lines.flatMap((l) => byId.get(l.lineId)!.partRecordId ?? []));

    for (const line of input.lines) {
      const row = byId.get(line.lineId)!;
      const cost = line.unitCostCents ?? (row.unitCostKnown ? row.unitCostCents : null);
      if (row.partRecordId) {
        await applyPartMovementsInTx(tx, userId, `${input.operationKey}:${row.id}`, [
          { partRecordId: row.partRecordId, kind: "RECEIPT", quantityDelta: line.quantity, unitCostCents: cost, purchaseOrderLineItemId: row.id },
        ]);
      }
      await tx.purchaseOrderLineItem.update({
        where: { id: row.id },
        data: {
          receivedQuantity: { increment: line.quantity },
          ...(line.unitCostCents !== null ? { unitCostCents: line.unitCostCents, unitCostKnown: true } : {}),
        },
      });
    }

    const after = await tx.purchaseOrderLineItem.findMany({ where: { purchaseOrderId: order.id }, select: { quantity: true, receivedQuantity: true } });
    const complete = after.every((l) => l.receivedQuantity >= l.quantity);
    if (complete) {
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "RECEIVED", receivedAt: new Date() } });
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: "purchase_order.receive",
        entityType: "PurchaseOrder",
        entityId: order.id,
        newValue: { operationKey: input.operationKey, lines: input.lines, completed: complete },
      },
    });
    return { replayed: false };
  });
}

/** On a retry: re-run each line's movement under the same key so a changed payload is still refused. */
async function replayLineMovements(
  tx: Prisma.TransactionClient,
  userId: string,
  orderLines: Array<{ id: string; partRecordId: string | null; unitCostKnown: boolean; unitCostCents: number }>,
  input: ReceiveLinesInput,
) {
  const byId = new Map(orderLines.map((l) => [l.id, l]));
  for (const line of input.lines) {
    const row = byId.get(line.lineId);
    if (!row?.partRecordId) continue;
    const cost = line.unitCostCents ?? (row.unitCostKnown ? row.unitCostCents : null);
    const request: PartMovementRequest = { partRecordId: row.partRecordId, kind: "RECEIPT", quantityDelta: line.quantity, unitCostCents: cost, purchaseOrderLineItemId: row.id };
    await applyPartMovementsInTx(tx, userId, `${input.operationKey}:${row.id}`, [request]);
  }
}

/**
 * Receives every quantity still outstanding on an ORDERED purchase order (the old "mark as
 * received"). Same effect as receivePurchaseOrderLines with the remaining amount on each line.
 */
export async function receivePurchaseOrder(userId: string, purchaseOrderId: string) {
  const order = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { lines: true } });
  if (!order) throw new Error("Couldn't find that purchase order.");
  if (order.status !== "ORDERED") throw new Error("Only a purchase order that's been marked as ordered can be received.");
  const lines = order.lines
    .filter((l) => l.quantity > l.receivedQuantity)
    .map((l) => ({ lineId: l.id, quantity: l.quantity - l.receivedQuantity, unitCostCents: null }));
  if (lines.length === 0) throw new Error("Everything on this order has already arrived.");
  await receivePurchaseOrderLines(userId, { purchaseOrderId, operationKey: `po-receive-all:${purchaseOrderId}`, lines });
}

export async function cancelPurchaseOrder(userId: string, purchaseOrderId: string) {
  await prisma.$transaction(async tx => {
    const claim = await tx.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, status: { in: ["DRAFT", "ORDERED"] } },
      data: { status: "CANCELLED" },
    });
    if (claim.count !== 1) throw new Error("This purchase order can't be cancelled anymore.");
    await tx.auditLog.create({ data: {
      userId, action: "purchase_order.cancel", entityType: "PurchaseOrder", entityId: purchaseOrderId,
    } });
  });
}

/**
 * Chris logging that he used some of a part on a repair. The quantity must be on hand: using more
 * than the count is refused (never silently floored), so a wrong shelf count gets fixed with a
 * recount instead of hiding. The movement records the part's last known purchase cost as an
 * estimate (blank when no receipt had a price). `operationKey` makes a retry harmless.
 */
export async function recordPartUsage(
  userId: string,
  partRecordId: string,
  quantity: number,
  options: { operationKey: string; jobId?: string | null },
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Enter how many were used.");
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    if (options.jobId) {
      const job = await tx.job.findUnique({ where: { id: options.jobId }, select: { id: true } });
      if (!job) throw new Error("Couldn't find that job.");
    }
    const cost = await lastKnownPurchaseCostCents(tx, partRecordId);
    await applyPartMovementsInTx(tx, userId, options.operationKey, [
      { partRecordId, kind: "USAGE", quantityDelta: -quantity, unitCostCents: cost, jobId: options.jobId ?? undefined, reason: "Used on a repair" },
    ]);
    return tx.partRecord.findUniqueOrThrow({ where: { id: partRecordId } });
  });
}

export type PartStockSettingsInput = {
  quantityOnHand: number;
  reorderThreshold: number | null;
};

/** Lets Chris correct a part's on-hand count directly (a physical recount) or set/clear its
 * reorder threshold. A changed count is written to the ledger as a RECOUNT movement. */
export async function updatePartStockSettings(
  userId: string,
  partRecordId: string,
  input: PartStockSettingsInput & { operationKey: string },
) {
  if (!Number.isSafeInteger(input.quantityOnHand) || input.quantityOnHand < 0) {
    throw new Error("Quantity on hand can't be negative.");
  }
  if (input.reorderThreshold !== null && (!Number.isSafeInteger(input.reorderThreshold) || input.reorderThreshold < 0)) {
    throw new Error("Reorder threshold can't be negative.");
  }

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    // Serialize requests for this part so two retries with the same key cannot both pass the check below.
    await lockPartRecords(tx, [partRecordId]);
    // A retry (lost response) must not redo this save over a later one, and must not be reused for a different save.
    const prior = await tx.auditLog.findFirst({
      where: { action: "part.stock_settings.update", entityId: partRecordId, newValue: { path: ["operationKey"], equals: input.operationKey } },
      select: { newValue: true },
    });
    if (prior) {
      const was = prior.newValue as { quantityOnHand?: number; reorderThreshold?: number | null };
      if (was.quantityOnHand !== input.quantityOnHand || (was.reorderThreshold ?? null) !== input.reorderThreshold) throw new PartOperationConflictError();
      return tx.partRecord.findUniqueOrThrow({ where: { id: partRecordId } });
    }
    await applyPartMovementsInTx(tx, userId, input.operationKey, [
      { partRecordId, kind: "RECOUNT", countedQuantity: input.quantityOnHand, unitCostCents: null, reason: "Counted on the shelf" },
    ]);
    const updated = await tx.partRecord.update({
      where: { id: partRecordId },
      data: { reorderThreshold: input.reorderThreshold },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "part.stock_settings.update",
        entityType: "PartRecord",
        entityId: partRecordId,
        newValue: { operationKey: input.operationKey, quantityOnHand: input.quantityOnHand, reorderThreshold: input.reorderThreshold },
      },
    });
    return updated;
  });
}

/** Undo a mistaken movement: adds a REVERSAL (the original row is never changed) so the count and cost come back. */
export async function reversePartMovement(userId: string, movementId: string, operationKey: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const original = await tx.partStockMovement.findUnique({ where: { id: movementId }, select: { partRecordId: true } });
    if (!original) throw new Error("Couldn't find that entry.");
    return applyPartMovementsInTx(tx, userId, operationKey, [
      { partRecordId: original.partRecordId, kind: "REVERSAL", reversesMovementId: movementId, unitCostCents: null, reason: reason ?? "Entered by mistake" },
    ]);
  });
}

/** The parts logged against one job, plus what they cost (itemized, or the legacy hand-entered number). */
export async function getJobPartsUsed(jobId: string) {
  const [movements, cost] = await Promise.all([
    prisma.partStockMovement.findMany({
      where: { jobId, kind: { in: ["USAGE", "REVERSAL"] } },
      include: { partRecord: { select: { modelNumber: true, partNumber: true, partName: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    jobPartsCost(prisma, jobId),
  ]);
  const reversed = new Set(movements.filter((m) => m.kind === "REVERSAL").map((m) => m.reversesMovementId));
  return {
    cost,
    rows: movements
      .filter((m) => m.kind === "USAGE")
      .map((m) => ({
        id: m.id,
        label: `${m.partRecord.modelNumber} — ${m.partRecord.partNumber}${m.partRecord.partName ? ` (${m.partRecord.partName})` : ""}`,
        quantity: -m.quantityDelta,
        unitCostCents: m.unitCostCents,
        reversed: reversed.has(m.id),
      })),
  };
}

async function setArchived(
  userId: string,
  entity: "part" | "supplier",
  id: string,
  archived: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const when = archived ? new Date() : null;
    const result =
      entity === "part"
        ? await tx.partRecord.updateMany({ where: { id, archivedAt: archived ? null : { not: null } }, data: { archivedAt: when } })
        : await tx.supplier.updateMany({ where: { id, archivedAt: archived ? null : { not: null } }, data: { archivedAt: when } });
    if (result.count === 0) {
      const exists =
        entity === "part"
          ? await tx.partRecord.findUnique({ where: { id }, select: { id: true } })
          : await tx.supplier.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new Error(`Couldn't find that ${entity}.`);
      return; // already in the requested state
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: `${entity}.${archived ? "archive" : "restore"}`,
        entityType: entity === "part" ? "PartRecord" : "Supplier",
        entityId: id,
      },
    });
  });
}

export const archivePartRecord = (userId: string, partRecordId: string) => setArchived(userId, "part", partRecordId, true);
export const restorePartRecord = (userId: string, partRecordId: string) => setArchived(userId, "part", partRecordId, false);
export const archiveSupplier = (userId: string, supplierId: string) => setArchived(userId, "supplier", supplierId, true);
export const restoreSupplier = (userId: string, supplierId: string) => setArchived(userId, "supplier", supplierId, false);

/** Every part with a reorder threshold set that's at or below it — the
 * "flag when a part I use often is low on hand" ask. A part with no
 * threshold set (the default) never appears here, since Chris hasn't
 * told the system he tracks stock of it. */
export async function getLowStockParts() {
  const parts = await prisma.partRecord.findMany({
    where: { reorderThreshold: { not: null }, archivedAt: null },
    include: { applianceType: true },
    orderBy: [{ modelNumber: "asc" }],
  });
  return parts.filter((p) => p.reorderThreshold !== null && p.quantityOnHand <= p.reorderThreshold);
}
