"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { saveDeductionLabels } from "@/domains/tax/setup";
import { RESEARCHED_DEDUCTION_DEFAULTS } from "@/domains/tax/deduction-labels";
import type { TaxActionState } from "../setup/actions";

const v = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * W-12 / IN-44 (Chris's amendment, 2026-10-31): the deduction wording is
 * saved from its own page so the business's accountant — the CPA the
 * IN-44 question is addressed to — can answer it in the app. The domain
 * stamps provenance from the saver's role and audit-logs every save;
 * nothing else about the filing account can be changed from here.
 */
export async function saveDeductionLabelsAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER", "ACCOUNTANT");
    const accountId = v(form, "accountId");
    const expectedRaw = v(form, "expectedUpdatedAt");
    if (!accountId || !expectedRaw) throw new Error("Missing account version. Refresh first.");
    const labels: Record<string, { label: string; reportAs: "DEDUCTION" | "LEAVE_OUT_OF_GROSS" }> = {};
    for (const key of form.keys()) {
      if (!key.startsWith("deductionLabel:")) continue;
      const bucket = key.slice("deductionLabel:".length);
      const def = RESEARCHED_DEDUCTION_DEFAULTS[bucket];
      if (form.get("deductionRestore:" + bucket) === "on" && def) {
        labels[bucket] = { label: def.label, reportAs: def.reportAs };
        continue;
      }
      const label = v(form, key);
      if (!label) continue;
      labels[bucket] = {
        label,
        reportAs: v(form, "deductionReportAs:" + bucket) === "LEAVE_OUT_OF_GROSS"
          ? "LEAVE_OUT_OF_GROSS" : "DEDUCTION",
      };
    }
    await saveDeductionLabels(session.user.id, accountId, labels, new Date(expectedRaw));
    revalidatePath("/desk/sales-tax/deduction-labels");
    revalidatePath("/desk/sales-tax/setup/accounts/" + accountId);
    return { error: "", success: "Deduction wording saved. The return packet uses it from now on." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not authorized|not allowed|role|permission|no longer has access/i.test(message))
      return { error: "Your access does not include saving deduction wording.", success: "" };
    if (/invalid|enter|changed|refresh|missing|must|cannot/i.test(message))
      return { error: message.slice(0, 500), success: "" };
    return { error: "Couldn't save this change. Check your entries and refresh.", success: "" };
  }
}
