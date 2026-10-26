"use server";
// FEE-1: what Chris can do about a late fee from the bill page and To do: send the warning, record a phone call,
// skip the fee, or waive a fee that is already recorded.
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { recordToldByPhone, sendLateNotice, skipLateFee, waiveLateFee } from "@/domains/billing/late-fee-engine";

function text(form: FormData, name: string, max = 400): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function refresh(invoiceId: string) {
  revalidatePath("/desk/today");
  revalidatePath("/desk/billing");
  revalidatePath(`/desk/billing/customer`, "layout");
  void invoiceId;
}

export async function sendLateWarningAction(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const invoiceId = text(form, "invoiceId", 200);
  if (!invoiceId) return;
  const result = await sendLateNotice(invoiceId, new Date(), session.user.id);
  refresh(invoiceId);
  if (result.state === "NOT_SENT") throw new Error("The warning could not be sent (the customer's email may be off). Call them, then choose “I told them by phone”.");
  if (result.state === "SKIPPED") throw new Error("This bill no longer needs a warning.");
}

export async function toldByPhoneAction(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const invoiceId = text(form, "invoiceId", 200);
  if (!invoiceId) return;
  await recordToldByPhone(invoiceId, session.user.id);
  refresh(invoiceId);
}

export async function skipLateFeeAction(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const invoiceId = text(form, "invoiceId", 200);
  if (!invoiceId) return;
  await skipLateFee(invoiceId, session.user.id, text(form, "reason"));
  refresh(invoiceId);
}

export async function waiveLateFeeAction(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const chargeId = text(form, "chargeId", 200);
  if (!chargeId) return;
  await waiveLateFee(chargeId, session.user.id, text(form, "reason"));
  refresh(chargeId);
}
