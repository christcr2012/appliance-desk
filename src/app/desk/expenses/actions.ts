"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { submitExpensePost } from "@/domains/approvals";
import {
  createExpense, voidExpense, attachExpenseReceipt, saveRecurringExpense, recordExpenseNoReceiptReason,
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
  try {
    const outcome = await callback();
    // An admin's action at or above the owner's limit is sent to the owner instead of happening.
    result = outcome && typeof outcome === "object" && "message" in outcome && "requestId" in outcome ? String((outcome as { message: string }).message) : "Saved.";
  }
  catch (error) { result = error instanceof Error ? error.message : "Request could not be saved."; }
  complete(action + " — " + result);
}
export async function createExpenseAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const mode = read(form, "mode");
  const wantsPosted = mode === "POSTED" && session.user.role !== "STAFF";
  await handled("Expense", async () => {
    const created = await createExpense(session.user.id, {
    date: read(form, "date"), amountCents: money(form, "amount"),
    vendorTaxCents: money(form, "vendorTax"), vendorName: read(form, "vendor"),
    categoryId: read(form, "categoryId"), paidFromAccountId: read(form, "paidFromAccountId"),
    memo: read(form, "memo"), applianceId: read(form, "applianceId"),
    jobId: read(form, "jobId"), purchaseOrderId: read(form, "purchaseOrderId"),
    capitalizeToAppliance: form.get("capitalize") === "on",
    budgetEnvelopeId: read(form,"budgetEnvelopeId"),
    noReceipt:form.get("noReceipt")==="on",noReceiptReason:read(form,"noReceiptReason"),
    }, wantsPosted ? "DRAFT" : mode === "DRAFT" && session.user.role !== "STAFF" ? "DRAFT" : "SUBMITTED");
    // "Post now" goes through the same limit check as the Post button (an admin over the owner's limit sends it for approval).
    return wantsPosted ? submitExpensePost(session.user.id, created.id, 1) : created;
  });
}
export async function postExpenseAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  await handled("Post expense", () =>
    submitExpensePost(session.user.id, read(form, "id"), Number(read(form, "version"))));
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
export async function explainMissingExpenseReceiptAction(form:FormData){
 const session=await requireRole("OWNER","ADMIN","STAFF");
 await handled("Receipt explanation",()=>
  recordExpenseNoReceiptReason(session.user.id,read(form,"id"),
   Number(read(form,"version")),read(form,"reason")));
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
