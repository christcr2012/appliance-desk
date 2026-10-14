"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { parseDollarInput } from "@/lib/money-ui";
import { saveSigningSetupFeeOverride } from "@/domains/billing/signing-setup-fee-override";

export type SetupFeeOverrideState = { success: string; error: string };
const str = (form: FormData, key: string) => typeof form.get(key) === "string"
  ? String(form.get(key)).trim() : "";

export async function saveSetupFeeOverrideAction(
  _previous: SetupFeeOverrideState, form: FormData,
): Promise<SetupFeeOverrideState> {
  const session = await requireRole("OWNER");
  const agreementId = str(form, "agreementId");
  const serviceAddressId = str(form, "serviceAddressId");
  const restore = form.get("operation") === "restore";
  try {
    const cents = restore ? null : parseDollarInput(str(form, "feeDollars"), 1_000_000);
    await saveSigningSetupFeeOverride(
      session.user.id, agreementId, serviceAddressId, cents, str(form, "reason"),
    );
    revalidatePath("/desk/agreements/" + agreementId);
    return { success: restore ? "Original configured setup fee restored." :
      "Owner fee adjustment recorded. Reprepare the signing order before sending.", error: "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return { success: "", error: /^(Enter|Record|Only|The signed|This location|Choose|Every|A fee)/.test(message)
      ? message : "The fee adjustment could not be saved. Check the draft and try again." };
  }
}
