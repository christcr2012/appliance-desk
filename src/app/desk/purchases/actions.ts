"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { businessDateFromKey } from "@/lib/business-date";
import { postBookSourceAfterCommit } from "@/domains/books/immediate";
import { parseDollarInput } from "@/lib/money-ui";
import { requireRole } from "@/lib/session";
import {
  PURCHASE_TAX_ANSWERS,
  addPurchaseDocuments,
  recordPurchase,
  removePurchaseDocument,
  updatePurchaseDetails,
  updatePurchaseTaxAnswer,
  type RecordedPurchase,
} from "@/domains/purchasing/purchases";

export type PurchaseActionResult =
  | { status: "error"; message: string }
  | { status: "success"; purchaseId: string; recorded?: SerializedRecorded };

/** Dates become text so the result can cross from the server to the browser. */
export type SerializedRecorded = Omit<RecordedPurchase, "purchasedOn" | "appliances"> & {
  purchasedOn: string;
  appliances: Array<Omit<RecordedPurchase["appliances"][number], "step"> & {
    step: { headline: string; detail: string; done: boolean; urgent: boolean };
  }>;
};

const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dollars = z.string().trim().max(20);

const recordSchema = z.object({
  operationKey: z.string().trim().min(8).max(100),
  supplierId: text(100),
  sellerName: text(200),
  purchasedOn: z.string().trim().min(1, "Enter the purchase date."),
  reference: text(100),
  taxAnswer: z.enum(PURCHASE_TAX_ANSWERS as unknown as [string, ...string[]], { message: "Answer the tax question." }),
  relatedParty: z.enum(["yes", "no", ""]).optional(),
  sellerTax: dollars,
  otherState: text(60),
  otherCharges: dollars,
  receiptSubtotal: dollars,
  receiptTotal: dollars,
  notes: text(2000),
  documents: z.array(z.object({ url: z.string().url().max(1024), altText: text(200) })).max(12),
  appliances: z.array(z.object({
    applianceTypeId: z.string().trim().min(1, "Choose a type for every appliance."),
    manufacturer: text(200), model: text(200), serialNumber: text(200),
    price: dollars, condition: text(200), color: text(100),
  })).min(1, "Add at least one appliance.").max(50),
});

function cents(value: string, label: string, required: boolean): number | null {
  if (!value.trim()) {
    if (required) throw new Error(`Enter ${label}.`);
    return null;
  }
  try { return parseDollarInput(value.replace(/^\$/, "").replace(/,/g, ""), 2_147_483_647); }
  catch { throw new Error(`${label[0]!.toUpperCase()}${label.slice(1)}: enter dollars and cents, like 125.50.`); }
}

export async function recordPurchaseAction(raw: unknown): Promise<PurchaseActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const data = parsed.data;
  const purchasedOn = businessDateFromKey(data.purchasedOn);
  if (!purchasedOn) return { status: "error", message: "Enter the purchase date as a real calendar date." };
  try {
    const recorded = await recordPurchase(session.user.id, {
      operationKey: data.operationKey,
      supplierId: data.supplierId || null,
      sellerName: data.sellerName || null,
      purchasedOn,
      reference: data.reference || null,
      taxAnswer: data.taxAnswer as never,
      boughtFromRelatedParty: data.relatedParty === "yes" ? true : data.relatedParty === "no" ? false : null,
      sellerTaxCents: cents(data.sellerTax, "the seller tax", false) ?? 0,
      otherState: data.otherState || null,
      otherChargesCents: cents(data.otherCharges, "delivery or other charges", false) ?? 0,
      receiptSubtotalCents: cents(data.receiptSubtotal, "the receipt subtotal", false),
      receiptTotalCents: cents(data.receiptTotal, "the receipt total", false),
      notes: data.notes || null,
      documents: data.documents.map((doc) => ({ url: doc.url, altText: doc.altText || null })),
      appliances: data.appliances.map((row, index) => ({
        applianceTypeId: row.applianceTypeId,
        manufacturer: row.manufacturer || null, model: row.model || null,
        serialNumber: row.serialNumber || null, condition: row.condition || null, color: row.color || null,
        priceCents: cents(row.price, `a price for appliance ${index + 1}`, true)!,
      })),
    });
    // The purchase is committed: record each appliance's capital source independently.
    // Book errors go to nightly catch-up and never undo the saved purchase.
    for (const appliance of recorded.appliances)
      await postBookSourceAfterCommit("APPLIANCE",appliance.id);

    revalidatePath("/desk/purchases");
    revalidatePath("/desk/inventory");
    revalidatePath("/desk/tasks");
    revalidatePath("/desk/today");
    const rest = { ...recorded, purchasedOn: recorded.purchasedOn.toISOString() };
    return {
      status: "success", purchaseId: recorded.purchaseId,
      recorded: {
        ...rest,
        appliances: recorded.appliances.map((a) => ({
          ...a,
          step: { headline: a.step.headline, detail: a.step.detail, done: a.step.done,
            urgent: a.step.todo?.severity === "high" },
        })),
      },
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save that purchase." };
  }
}

const taxSchema = z.object({
  purchaseId: z.string().min(1),
  expectedTaxRevisionAt: z.string().min(1, "Reload the page and try again."),
  taxAnswer: z.enum(PURCHASE_TAX_ANSWERS as unknown as [string, ...string[]], { message: "Answer the tax question." }),
  sellerTax: dollars,
  otherState: text(60),
});

export async function updatePurchaseTaxAction(raw: unknown): Promise<PurchaseActionResult> {
  const session = await requireRole("OWNER");
  const parsed = taxSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const data = parsed.data;
  const revision = new Date(data.expectedTaxRevisionAt);
  if (!Number.isFinite(revision.getTime())) return { status: "error", message: "Reload the page and try again." };
  try {
    await updatePurchaseTaxAnswer(session.user.id, {
      purchaseId: data.purchaseId, expectedTaxRevisionAt: revision, taxAnswer: data.taxAnswer as never,
      sellerTaxCents: cents(data.sellerTax, "the seller tax", false) ?? 0, otherState: data.otherState || null,
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save the tax answer." };
  }
  for (const path of ["/desk/purchases", `/desk/purchases/${data.purchaseId}`, "/desk/inventory", "/desk/tasks", "/desk/today", "/desk/sales-tax"]) revalidatePath(path);
  return { status: "success", purchaseId: data.purchaseId };
}

const detailsSchema = z.object({
  purchaseId: z.string().min(1), supplierId: text(100), sellerName: text(200), reference: text(100), notes: text(2000),
});

export async function updatePurchaseDetailsAction(raw: unknown): Promise<PurchaseActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = detailsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  try {
    await updatePurchaseDetails(session.user.id, {
      purchaseId: d.purchaseId, supplierId: d.supplierId || null, sellerName: d.sellerName || null,
      reference: d.reference || null, notes: d.notes || null,
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save those details." };
  }
  revalidatePath("/desk/purchases"); revalidatePath(`/desk/purchases/${d.purchaseId}`);
  return { status: "success", purchaseId: d.purchaseId };
}

const documentsSchema = z.object({
  purchaseId: z.string().min(1),
  documents: z.array(z.object({ url: z.string().url().max(1024) })).min(1, "Choose at least one receipt page.").max(12),
});

export async function addPurchaseDocumentsAction(raw: unknown): Promise<PurchaseActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = documentsSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Choose a receipt page." };
  try {
    await addPurchaseDocuments(session.user.id, parsed.data.purchaseId, parsed.data.documents);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't attach the receipt." };
  }
  revalidatePath(`/desk/purchases/${parsed.data.purchaseId}`);
  return { status: "success", purchaseId: parsed.data.purchaseId };
}

export async function removePurchaseDocumentAction(purchaseId: string, documentId: string): Promise<PurchaseActionResult> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await removePurchaseDocument(session.user.id, documentId);
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't remove that page." };
  }
  revalidatePath(`/desk/purchases/${purchaseId}`);
  return { status: "success", purchaseId };
}
