"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import {
  createExpense, postExpense, voidExpense, attachExpenseReceipt, saveRecurringExpense,
} from "@/domains/books/expenses";

const read = (form: FormData, field: string) => String(form.get(field) ?? "").trim();
const money = (form: FormData, field: string) => {
  const text = read(form, field);
  if (!/^[0-9]{1,8}(?:\.[0-9]{1,2})?$/.test(text))
    throw new Error("Enter dollars and cents using a positive whole-cent amount.");
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
function complete(message: string): never {
  revalidatePath("/desk/expenses");
  revalidatePath("/desk/books");
  redirect("/desk/expenses?notice=" + encodeURIComponent(message));
}
async function handled(action: string, callback: () => Promise<unknown>) {
  let result = "";
  try { await callback(); result = "Saved."; }
  catch (error) { result = error instanceof Error ? error.message : "Request could not be saved."; }
  complete(action + " — " + result);
}
export async function createExpenseAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const mode = read(form, "mode");
  await handled("Expense", () => createExpense(session.user.id, {
    date: read(form, "date"), amountCents: money(form, "amount"),
    vendorTaxCents: money(form, "vendorTax"), vendorName: read(form, "vendor"),
    categoryId: read(form, "categoryId"), paidFromAccountId: read(form, "paidFromAccountId"),
    memo: read(form, "memo"), applianceId: read(form, "applianceId"),
    jobId: read(form, "jobId"), purchaseOrderId: read(form, "purchaseOrderId"),
    capitalizeToAppliance: form.get("capitalize") === "on",
    budgetEnvelopeId: read(form,"budgetEnvelopeId"),
  }, mode === "POSTED" && session.user.role !== "STAFF" ? "POSTED" :
    mode === "DRAFT" && session.user.role !== "STAFF" ? "DRAFT" : "SUBMITTED"));
}
export async function postExpenseAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  await handled("Post expense", () =>
    postExpense(session.user.id, read(form, "id"), Number(read(form, "version"))));
}
export async function voidExpenseAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  await handled("Void expense", () =>
    voidExpense(session.user.id, read(form, "id"), Number(read(form, "version")), read(form, "reason")));
}
export async function attachExpenseReceiptAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  await handled("Private receipt", () =>
    attachExpenseReceipt(session.user.id, read(form, "id"), read(form, "url")));
}
export async function saveRecurringAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  await handled("Recurring expense", () => saveRecurringExpense(session.user.id, {
    name: read(form, "name"), vendorName: read(form, "vendor"),
    amountCents: money(form, "amount"), categoryId: read(form, "categoryId"),
    paidFromAccountId: read(form, "paidFromAccountId"),
    dayOfMonth: Number(read(form, "day")), active: form.get("active") === "on",
  }, read(form, "id") || undefined));
}
