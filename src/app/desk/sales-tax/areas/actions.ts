"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { confirmAddressLocation } from "@/domains/tax/locations";
import {
  manuallyApplyObservedRate, undoAutoAppliedRateVersion,
} from "@/domains/tax/official-rate-auto-apply";
import { acknowledgeOfficialSourceChange } from "@/domains/tax/official-source-watch";
import type { TaxActionState } from "../setup/actions";

function fail(error: unknown): TaxActionState {
  const raw = error instanceof Error ? error.message : "";
  return { success: "", error: /failed|changed|already|only|missing|review|find|invalid|cannot/i.test(raw)
    ? raw.slice(0, 250) : "This tax review couldn't be saved. Refresh and review the latest evidence." };
}
const get = (data: FormData, field: string): string => {
  const v = data.get(field);
  return typeof v === "string" ? v.trim() : "";
};
export async function reviewOfficialRate(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const user = await requireRole("OWNER");
    await manuallyApplyObservedRate({
      observationId: get(form, "observationId"), actorUserId: user.user.id,
    });
    const { recalculatePendingPurchaseTax } = await import("@/domains/tax/purchase-tax-catch-up");
    await recalculatePendingPurchaseTax(new Date(), 200);
    revalidatePath("/desk/sales-tax/areas");
    return { success: "The recorded observation was reviewed and applied.", error: "" };
  } catch (e) { return fail(e); }
}
export async function undoOfficialRate(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const user = await requireRole("OWNER");
    await undoAutoAppliedRateVersion({
      rateVersionId: get(form, "rateVersionId"), actorUserId: user.user.id,
    });
    revalidatePath("/desk/sales-tax/areas");
    return { success: "The automatic rate was undone with an audit record.", error: "" };
  } catch (e) { return fail(e); }
}
export async function acknowledgeSource(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    await requireRole("OWNER");
    const changed = await acknowledgeOfficialSourceChange(get(form, "watchId"), get(form, "version"));
    revalidatePath("/desk/sales-tax/areas");
    return changed ? { success: "Source change acknowledged.", error: "" }
      : { success: "", error: "Source changed again. Refresh and review its new evidence." };
  } catch (e) { return fail(e); }
}


export async function confirmAddressAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const actor = await requireRole("OWNER", "ADMIN");
    const serviceAddressId = get(form, "serviceAddressId");
    const jurisdictions = form.getAll("jurisdictionIds").filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (jurisdictions.length < 1 || jurisdictions.length > 25 ||
        jurisdictions.some(id => id.length > 128) ||
        new Set(jurisdictions).size !== jurisdictions.length)
      throw new Error("Choose one to 25 distinct tax areas.");
    const reviewed = await prisma.taxJurisdiction.count({
      where: { id: { in: jurisdictions }, reviewStatus: "REVIEWED" },
    });
    if (reviewed !== jurisdictions.length)
      throw new Error("Every selected tax area must be reviewed before verification.");
    await confirmAddressLocation(actor.user.id, { serviceAddressId, jurisdictionIds: jurisdictions });
    revalidatePath("/desk/sales-tax/areas");
    return { success: "Address tax areas verified with your selection.", error: "" };
  } catch (error) { return fail(error); }
}

