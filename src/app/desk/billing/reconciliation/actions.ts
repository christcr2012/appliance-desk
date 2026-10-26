"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { recoverBankSettlement } from "@/domains/billing/in-flight-check";

/** "Record it now": owner or admin records a bank payment Stripe says cleared. Records once; a second press changes nothing. */
export async function recordBankPaymentAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const rowId = formData.get("rowId");
  if (typeof rowId !== "string" || !rowId || rowId.length > 200) return;
  const outcome = await recoverBankSettlement(rowId, session.user.id);
  revalidatePath("/desk/today");
  revalidatePath("/desk/billing");
  revalidatePath("/desk/billing/reconciliation");
  if (outcome === "not_paid") throw new Error("Stripe doesn't show this payment as paid yet. Nothing was recorded.");
  if (outcome === "cannot_record") throw new Error("This payment couldn't be recorded automatically. Open it in Stripe to check.");
}
