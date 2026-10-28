"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import {
  checkEstimateDeliveryZones, confirmEstimateZoneMiles, recordPickupArranged, setEstimateDeliveryChoiceByStaff,
} from "@/domains/delivery/estimate-zone";

/** ZONE-1 desk forms on an estimate (owner/admin). Plain form posts; the answer comes back in the page address. */
function back(estimateId: string, outcome: { ok: true; note: string } | { ok: false; message: string }): never {
  revalidatePath("/desk/estimates/" + estimateId);
  revalidatePath("/estimate/" + estimateId);
  revalidatePath("/desk/today");
  const query = outcome.ok ? `zoneNote=${encodeURIComponent(outcome.note)}` : `zoneError=${encodeURIComponent(outcome.message)}`;
  redirect(`/desk/estimates/${encodeURIComponent(estimateId)}?${query}#delivery-zone`);
}

const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 200) : "That didn't work. Try again.";

export async function checkZoneAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const estimateId = String(form.get("estimateId") ?? "");
  let outcome: Parameters<typeof back>[1];
  try {
    await checkEstimateDeliveryZones(session.user.id, estimateId);
    outcome = { ok: true, note: "Delivery zone checked." };
  } catch (error) { outcome = { ok: false, message: message(error) }; }
  back(estimateId, outcome);
}

export async function setZoneChoiceAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const estimateId = String(form.get("estimateId") ?? "");
  const choice = form.get("choice") === "CUSTOMER_PICKUP" ? "CUSTOMER_PICKUP" : "DELIVER";
  let outcome: Parameters<typeof back>[1];
  try {
    await setEstimateDeliveryChoiceByStaff(session.user.id, estimateId, String(form.get("serviceAddressId") ?? ""), choice);
    outcome = { ok: true, note: choice === "DELIVER" ? "Set to delivery." : "Set to customer pickup." };
  } catch (error) { outcome = { ok: false, message: message(error) }; }
  back(estimateId, outcome);
}

export async function confirmZoneMilesAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const estimateId = String(form.get("estimateId") ?? "");
  let outcome: Parameters<typeof back>[1];
  try {
    await confirmEstimateZoneMiles(session.user.id, estimateId, String(form.get("serviceAddressId") ?? ""),
      Number(String(form.get("miles") ?? "").trim() || Number.NaN), String(form.get("reason") ?? ""));
    outcome = { ok: true, note: "Delivery zone confirmed." };
  } catch (error) { outcome = { ok: false, message: message(error) }; }
  back(estimateId, outcome);
}

export async function pickupArrangedAction(form: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const estimateId = String(form.get("estimateId") ?? "");
  let outcome: Parameters<typeof back>[1];
  try {
    await recordPickupArranged(session.user.id, estimateId, String(form.get("serviceAddressId") ?? ""),
      String(form.get("note") ?? ""));
    outcome = { ok: true, note: "Pickup plan saved." };
  } catch (error) { outcome = { ok: false, message: message(error) }; }
  back(estimateId, outcome);
}
