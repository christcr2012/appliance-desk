"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { businessDateFromKey } from "@/lib/business-date";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import {
  saveFilingEntryProgress, markPeriodFiled, markAmendmentFiled,
  markAmendmentHandledOutside,
} from "@/domains/tax/filing";
import type { TaxActionState } from "../setup/actions";

const val = (f: FormData, key: string): string => {
  const x = f.get(key);
  return typeof x === "string" ? x.trim() : "";
};
function date(value: string, name: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? businessDateFromKey(value) : null;
  if (!date) throw new Error("Enter a valid " + name + " date.");
  return date;
}
function amount(value: string): number {
  if (!/^(0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter a valid nonnegative dollar amount (for example 12.34).");
  const [d, c = ""] = value.split(".");
  const result = BigInt(d!) * BigInt(100) + BigInt(c.padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large.");
  return Number(result);
}
function errorState(error: unknown): TaxActionState {
  const text = error instanceof Error ? error.message : "";
  return { error: text.length > 250 ? text.slice(0, 250) : text || "Could not save this return.", success: "" };
}
const refreshed = (periodId: string) => {
  revalidatePath("/desk/sales-tax/returns");
  revalidatePath(`/desk/sales-tax/returns/${periodId}`);
  revalidatePath(`/desk/sales-tax/returns/${periodId}/amend`);
};
export async function saveReturnProgressAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    const periodId = val(form, "periodId");
    const load = await loadFilingPacket(periodId);
    if (load.status !== "READY") throw new Error("Resolve filing blockers before saving the checklist.");
    const marked = form.getAll("complete").filter((v): v is string => typeof v === "string");
    const allowed = new Set(load.packet.steps.map((_, index) => "step:" + index));
    if (marked.some(key => !allowed.has(key))) throw new Error("Checklist changed. Refresh the return.");
    const entryProgress: Record<string, boolean> = {};
    load.packet.steps.forEach((_, index) => {
      const key = "step:" + index;
      entryProgress[key] = marked.includes(key);
    });
    await saveFilingEntryProgress(session.user.id, { periodId, entryProgress });
    refreshed(periodId);
    return { success: "Checklist progress saved. No filing or payment has been reported.", error: "" };
  } catch (e) { return errorState(e); }
}
export async function recordFiledReturnAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    const periodId = val(form, "periodId");
    await markPeriodFiled(session.user.id, {
      periodId,
      filedOn: date(val(form, "filedOn"), "filed"),
      paidOn: date(val(form, "paidOn"), "paid"),
      amountPaidCents: amount(val(form, "amountPaidDollars")),
      confirmationNumber: val(form, "confirmationNumber"),
      amountDifferentReason: val(form, "amountDifferentReason") || undefined,
      confirmationPhotoUrl: val(form, "confirmationPhotoUrl") || null,
    });
    refreshed(periodId);
    return { success: "Filed return and payment recorded with a frozen worksheet.", error: "" };
  } catch (e) { return errorState(e); }
}
export async function recordFiledAmendmentAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    const amendmentId = val(form, "amendmentId");
    const periodId = val(form, "periodId");
    await markAmendmentFiled(session.user.id, {
      amendmentId,
      filedOn: date(val(form, "filedOn"), "amendment filed"),
      paidOn: date(val(form, "paidOn"), "amendment paid"),
      amountPaidCents: amount(val(form, "amountPaidDollars")),
      confirmationNumber: val(form, "confirmationNumber"),
      amountDifferentReason: val(form, "amountDifferentReason") || undefined,
    });
    refreshed(periodId);
    return { success: "Amendment filed with immutable confirmation.", error: "" };
  } catch (e) { return errorState(e); }
}
export async function recordAmendmentHandledAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    await markAmendmentHandledOutside(session.user.id, {
      amendmentId: val(form, "amendmentId"),
      reason: val(form, "reason"),
    });
    refreshed(val(form, "periodId"));
    return { success: "Existing credit/zero-tax amendment marked handled, with audit evidence.", error: "" };
  } catch (e) { return errorState(e); }
}

