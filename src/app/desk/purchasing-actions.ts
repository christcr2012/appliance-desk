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
  cancelPurchaseOrder,
  recordPartUsage,
  updatePartStockSettings,
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
        unitCostCents: line.unitCostDollars ? dollarsToCents(line.unitCostDollars) : 0,
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
): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await recordPartUsage(session.user.id, partRecordId, quantity);
    revalidatePath("/desk/parts");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't record that." };
  }
}

export async function updatePartStockSettingsAction(
  partRecordId: string,
  quantityOnHand: number,
  reorderThreshold: number | null,
): Promise<PurchasingActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await updatePartStockSettings(session.user.id, partRecordId, { quantityOnHand, reorderThreshold });
    revalidatePath("/desk/parts");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save those changes." };
  }
}
