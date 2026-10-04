"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createSupplier,
  updateSupplier,
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
  receivePurchaseOrderLines,
  cancelPurchaseOrder,
  recordPartUsage,
  updatePartStockSettings,
  archivePartRecord,
  reversePartMovement,
  restorePartRecord,
  archiveSupplier,
  restoreSupplier,
} from "@/domains/purchasing";
import { dollarsToCents } from "@/domains/pricing";

// ---------------------------------------------------------------------------
// Purchasing & supplies (2026-09-29) — server actions for
// /desk/suppliers and /desk/purchase-orders, plus the stock-tracking
// actions surfaced on /desk/parts. Same requireRole("OWNER", "ADMIN")
// gate as every other financial/inventory action in this app.
// ---------------------------------------------------------------------------

export type PurchasingActionState =
  | { status: "idle" }
  | { status: "success"; id?: string }
  | { status: "error"; message: string };

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter a supplier name."),
  contactName: z.string().trim().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address.").max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function createSupplierAction(raw: unknown): Promise<PurchasingActionState> {
  await requireRole("OWNER", "ADMIN");
  const parsed = supplierSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields." };
  }

  try {
    const supplier = await createSupplier(parsed.data);
    revalidatePath("/desk/suppliers");
    return { status: "success", id: supplier.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't add that supplier." };
  }
}

export async function updateSupplierAction(
  supplierId: string,
  raw: unknown,
): Promise<PurchasingActionState> {
  await requireRole("OWNER", "ADMIN");
  const parsed = supplierSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields." };
  }

  try {
    await updateSupplier(supplierId, parsed.data);
    revalidatePath(`/desk/suppliers/${supplierId}`);
    revalidatePath("/desk/suppliers");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save those changes." };
  }
}

const poLineSchema = z.object({
  partRecordId: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1),
  unitCostDollars: z.coerce.number().min(0).optional(),
});

const newPurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  lines: z.array(poLineSchema).min(1, "Add at least one line."),
});

export async function createPurchaseOrderAction(raw: unknown): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = newPurchaseOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields." };
  }

  try {
    const order = await createPurchaseOrder(session.user.id, {
      supplierId: parsed.data.supplierId,
      notes: parsed.data.notes,
      lines: parsed.data.lines.map((line) => ({
        partRecordId: line.partRecordId || null,
        description: line.description,
        quantity: line.quantity,
        // Left blank = the price is not known yet (stored as unknown, not as $0).
        unitCostCents: line.unitCostDollars === undefined ? undefined : dollarsToCents(line.unitCostDollars),
      })),
    });
    revalidatePath("/desk/purchase-orders");
    return { status: "success", id: order.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't create that purchase order." };
  }
}

export async function markPurchaseOrderOrderedAction(purchaseOrderId: string): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await markPurchaseOrderOrdered(session.user.id, purchaseOrderId);
    revalidatePath(`/desk/purchase-orders/${purchaseOrderId}`);
    revalidatePath("/desk/purchase-orders");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't update that purchase order." };
  }
}

export async function receivePurchaseOrderAction(purchaseOrderId: string): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await receivePurchaseOrder(session.user.id, purchaseOrderId);
    revalidatePath(`/desk/purchase-orders/${purchaseOrderId}`);
    revalidatePath("/desk/purchase-orders");
    revalidatePath("/desk/parts");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't mark that as received." };
  }
}

export async function cancelPurchaseOrderAction(purchaseOrderId: string): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await cancelPurchaseOrder(session.user.id, purchaseOrderId);
    revalidatePath(`/desk/purchase-orders/${purchaseOrderId}`);
    revalidatePath("/desk/purchase-orders");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't cancel that purchase order." };
  }
}

export async function recordPartUsageAction(
  partRecordId: string,
  quantity: number,
  operationKey: string,
  jobId?: string,
): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await recordPartUsage(session.user.id, partRecordId, quantity, { operationKey, jobId: jobId ?? null });
    revalidatePath("/desk/parts");
    if (jobId) {
      revalidatePath(`/desk/jobs/${jobId}`);
      revalidatePath("/desk/fleet");
    }
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't record that." };
  }
}

export async function updatePartStockSettingsAction(
  partRecordId: string,
  quantityOnHand: number,
  reorderThreshold: number | null,
  operationKey: string,
): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await updatePartStockSettings(session.user.id, partRecordId, { quantityOnHand, reorderThreshold, operationKey });
    revalidatePath("/desk/parts");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save those changes." };
  }
}

const receiveLinesSchema = z.object({
  purchaseOrderId: z.string().trim().min(1).max(64),
  operationKey: z.string().trim().min(8).max(70),
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1).max(64),
        quantity: z.number().int().min(1).max(100000),
        unitCostDollars: z.string().trim().max(12).optional(),
      }),
    )
    .min(1, "Enter how many arrived on at least one line."),
});

/** Record what actually arrived (all or part of an order). A blank price keeps the ordered price, or stays unknown. */
export async function receivePurchaseOrderLinesAction(raw: unknown): Promise<PurchasingActionState & { replayed?: boolean }> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = receiveLinesSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields." };
  }
  const lines: { lineId: string; quantity: number; unitCostCents: number | null }[] = [];
  for (const line of parsed.data.lines) {
    const text = (line.unitCostDollars ?? "").replace(/^\$/, "");
    if (text === "") {
      lines.push({ lineId: line.lineId, quantity: line.quantity, unitCostCents: null });
      continue;
    }
    const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) return { status: "error", message: "Price per item: enter dollars and cents, like 12 or 12.50, or leave it blank." };
    lines.push({ lineId: line.lineId, quantity: line.quantity, unitCostCents: Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) });
  }
  try {
    const result = await receivePurchaseOrderLines(session.user.id, {
      purchaseOrderId: parsed.data.purchaseOrderId,
      operationKey: parsed.data.operationKey,
      lines,
    });
    revalidatePath(`/desk/purchase-orders/${parsed.data.purchaseOrderId}`);
    revalidatePath("/desk/purchase-orders");
    revalidatePath("/desk/parts");
    return { status: "success", replayed: result.replayed };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't record that delivery." };
  }
}

/** Hide a part from lists (keeps its history), or bring it back. */
export async function setPartArchivedAction(partRecordId: string, archived: boolean): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await (archived ? archivePartRecord : restorePartRecord)(session.user.id, partRecordId);
    revalidatePath("/desk/parts");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't change that part." };
  }
}

/** Hide a supplier from pickers (keeps its history), or bring it back. */
export async function setSupplierArchivedAction(supplierId: string, archived: boolean): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await (archived ? archiveSupplier : restoreSupplier)(session.user.id, supplierId);
    revalidatePath("/desk/suppliers");
    revalidatePath(`/desk/suppliers/${supplierId}`);
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't change that supplier." };
  }
}

/** Undo a mistaken parts entry (adds a reversal; the original stays in the history). */
export async function reversePartMovementAction(movementId: string, operationKey: string, jobId?: string): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await reversePartMovement(session.user.id, movementId, operationKey);
    revalidatePath("/desk/parts");
    if (jobId) {
      revalidatePath(`/desk/jobs/${jobId}`);
      revalidatePath("/desk/fleet");
    }
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't undo that." };
  }
}
