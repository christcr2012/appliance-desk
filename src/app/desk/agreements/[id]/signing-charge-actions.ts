"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prepareDraftSigningChargeSnapshots } from "@/domains/billing/signing-charge-snapshot";

export type PrepareSigningChargeState = { ok: boolean; message: string };

export async function prepareSigningChargesAction(
  _previous: PrepareSigningChargeState,
  formData: FormData,
): Promise<PrepareSigningChargeState> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = formData.get("agreementId");
  if (typeof agreementId !== "string" || !/^[a-zA-Z0-9_-]{10,100}$/.test(agreementId)) {
    return { ok: false, message: "Choose a valid draft agreement." };
  }
  try {
    const result = await prepareDraftSigningChargeSnapshots(session.user.id, agreementId);
    revalidatePath(`/desk/agreements/${agreementId}`);
    return {
      ok: true,
      message: `Prepared draft costs for ${result.snapshots.length} agreement(s). No payment was collected.`,
    };
  } catch {
    return {
      ok: false,
      message: "Could not prepare charges. Make sure every agreement in this order is a complete draft, then try again.",
    };
  }
}
