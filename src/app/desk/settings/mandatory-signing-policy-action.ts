"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  recordMandatorySigningPolicy, type MandatoryChargeDecision,
} from "@/domains/billing/signing-mandatory-policy";

export type MandatorySigningPolicyFormState = { error: string; success: string };
const keys = ["delivery", "installation", "removal", "damageWaiver", "retailDelivery"] as const;
export async function saveMandatorySigningPolicyAction(
  _prev: MandatorySigningPolicyFormState, form: FormData,
): Promise<MandatorySigningPolicyFormState> {
  try {
    const session = await requireRole("OWNER");
    const decisions = Object.fromEntries(keys.map(key =>
      [key, String(form.get(key) ?? "")])) as MandatoryChargeDecision;
    const value = await recordMandatorySigningPolicy(session.user.id, {
      effectiveFromKey: String(form.get("effectiveFromKey") ?? ""),
      reason: String(form.get("reason") ?? ""),
      decisions,
    });
    revalidatePath("/desk/settings");
    revalidatePath("/desk/estimates");
    return { error: "", success: "Policy revision " + value.revision +
      " saved. This does not authorize customer money collection or binding terms." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Policy could not be saved.", success: "" };
  }
}
