import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Purchasing & supplies (2026-09-29) — see docs/BUSINESS-RULES.md's
// "Purchasing & supplies" section. Deliberately minimal: a Supplier is
// just contact info, a PurchaseOrder moves DRAFT → ORDERED → RECEIVED
// (or CANCELLED at any point before RECEIVED), and receiving one adds
// its lines' quantities onto PartRecord.quantityOnHand — the only thing
// this app tracks stock for. There's no purchasing approval workflow,
// no per-line partial receiving, and no automatic consumption tracking
// (a part used on a repair only leaves quantityOnHand when Chris says
// so, via recordPartUsage) — a one-person operation doesn't need more
// process than that, and a heavier system would just be paperwork he'd
// stop keeping current.
// ---------------------------------------------------------------------------

export type NewSupplierInput = {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
};

export async function getSuppliers() {
  return prisma.supplier.findMany({
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

  const order = await prisma.purchaseOrder.create({
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
          })),
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "purchase_order.create",
      entityType: "PurchaseOrder",
      entityId: order.id,
      newValue: { supplierId: input.supplierId, lineCount: input.lines.length },
    },
  });

  return order;
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
  const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
  if (order.status !== "DRAFT") {
    throw new Error("Only a draft purchase order can be marked as ordered.");
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: "ORDERED", orderedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "purchase_order.order",
      entityType: "PurchaseOrder",
      entityId: purchaseOrderId,
    },
  });

  return updated;
}

/**
 * Marks an ORDERED purchase order as received — for every line tied to
 * a real PartRecord (partRecordId set), adds that line's full quantity
 * onto PartRecord.quantityOnHand. Deliberately all-or-nothing per order
 * (no partial-quantity receiving): a smaller shipment than ordered is
 * still an honest, real event, but tracking "3 of 5 arrived, 2 more
 * still coming" is a second, more complex workflow a one-person
 * operation doesn't need on day one — if a shipment genuinely comes up
 * short, Chris can use recordPartUsage's inverse (adjust the quantity
 * by hand, or just note it) rather than this needing to model partial
 * receipts. Idempotent in effect (status must be ORDERED to run again),
 * so this can't accidentally double-add stock.
 */
export async function receivePurchaseOrder(userId: string, purchaseOrderId: string) {
  const order = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (order.status !== "ORDERED") {
    throw new Error("Only a purchase order that's been marked as ordered can be received.");
  }

  await prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      if (line.partRecordId) {
        await tx.partRecord.update({
          where: { id: line.partRecordId },
          data: { quantityOnHand: { increment: line.quantity } },
        });
      }
    }

    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: "RECEIVED", receivedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "purchase_order.receive",
        entityType: "PurchaseOrder",
        entityId: purchaseOrderId,
        newValue: { lineCount: order.lines.length },
      },
    });
  });
}

export async function cancelPurchaseOrder(userId: string, purchaseOrderId: string) {
  const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
  if (order.status === "RECEIVED" || order.status === "CANCELLED") {
    throw new Error("This purchase order can't be cancelled anymore.");
  }

  await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: "CANCELLED" },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "purchase_order.cancel",
      entityType: "PurchaseOrder",
      entityId: purchaseOrderId,
    },
  });
}

/** Chris logging that he used some of a part on a real repair —
 * deliberately manual (see the file comment for why) rather than tied
 * to any job/maintenance record automatically. Clamped at 0 — this is a
 * count of physical parts on a shelf, which can never go negative, so a
 * typo (using more than's on hand) is silently floored rather than
 * producing a confusing negative count. */
export async function recordPartUsage(userId: string, partRecordId: string, quantity: number) {
  if (quantity < 1) {
    throw new Error("Enter how many were used.");
  }

  const part = await prisma.partRecord.findUniqueOrThrow({ where: { id: partRecordId } });
  const newQuantity = Math.max(0, part.quantityOnHand - quantity);

  const updated = await prisma.partRecord.update({
    where: { id: partRecordId },
    data: { quantityOnHand: newQuantity },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "part.use",
      entityType: "PartRecord",
      entityId: partRecordId,
      oldValue: { quantityOnHand: part.quantityOnHand },
      newValue: { quantityOnHand: newQuantity, usedQuantity: quantity },
    },
  });

  return updated;
}

export type PartStockSettingsInput = {
  quantityOnHand: number;
  reorderThreshold: number | null;
};

/** Lets Chris correct a part's on-hand count directly (a physical
 * recount, a correction) or set/clear its reorder threshold — separate
 * from recordPartUsage, which only ever moves the count down by a used
 * amount. */
export async function updatePartStockSettings(
  userId: string,
  partRecordId: string,
  input: PartStockSettingsInput,
) {
  if (input.quantityOnHand < 0) {
    throw new Error("Quantity on hand can't be negative.");
  }
  if (input.reorderThreshold !== null && input.reorderThreshold < 0) {
    throw new Error("Reorder threshold can't be negative.");
  }

  const updated = await prisma.partRecord.update({
    where: { id: partRecordId },
    data: {
      quantityOnHand: input.quantityOnHand,
      reorderThreshold: input.reorderThreshold,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "part.stock_settings.update",
      entityType: "PartRecord",
      entityId: partRecordId,
      newValue: input,
    },
  });

  return updated;
}

/** Every part with a reorder threshold set that's at or below it — the
 * "flag when a part I use often is low on hand" ask. A part with no
 * threshold set (the default) never appears here, since Chris hasn't
 * told the system he tracks stock of it. */
export async function getLowStockParts() {
  const parts = await prisma.partRecord.findMany({
    where: { reorderThreshold: { not: null } },
    include: { applianceType: true },
    orderBy: [{ modelNumber: "asc" }],
  });
  return parts.filter((p) => p.reorderThreshold !== null && p.quantityOnHand <= p.reorderThreshold);
}
