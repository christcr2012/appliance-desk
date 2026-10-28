"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { getBusinessSettings } from "@/domains/settings";
import { saveZoneSettings, getZoneSettings, ZoneSettingsError } from "@/domains/delivery/settings";
import { geocodeAddress } from "@/domains/delivery/geocode";
import { roundGeoPoint, startingZoneSettings, ZONE_COLORS, type DistanceMethod, type ZoneColor, type ZoneSettings } from "@/domains/delivery/zone";
import { dollarsToCents } from "@/domains/pricing/money";

export type ZoneFormState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

const num = (form: FormData, key: string) => {
  const raw = String(form.get(key) ?? "").trim();
  return raw === "" ? Number.NaN : Number(raw);
};

/** Settings › Delivery zones. Owner only; every save is compare-and-set and audited (src/domains/delivery/settings.ts). */
export async function saveDeliveryZonesAction(_previous: ZoneFormState, form: FormData): Promise<ZoneFormState> {
  const session = await requireRole("OWNER");
  const revision = String(form.get("revision") ?? "");
  const operation = String(form.get("operation") ?? "save");
  try {
    const current = await getZoneSettings();
    let next: ZoneSettings;
    if (operation === "restore") {
      next = { ...startingZoneSettings(), showPricesOnWebsite: current.showPricesOnWebsite };
    } else if (operation === "shop") {
      const settings = await getBusinessSettings();
      const address = settings.publicAddress ?? "";
      if (!address || address.startsWith("[")) return { status: "error", message: "Add your business address in Business profile first." };
      const found = await geocodeAddress({ line1: address });
      if (found.status !== "FOUND") {
        return { status: "error", message: "The address lookup couldn't place your business address. The center was not changed." };
      }
      next = { ...current, center: roundGeoPoint(found.point) };
    } else {
      const count = Math.min(5, Math.max(1, Number(form.get("zoneCount") ?? current.zones.length) || current.zones.length));
      const zones = Array.from({ length: count }, (_, index) => ({
        name: String(form.get(`name_${index}`) ?? ""),
        outerMiles: num(form, `miles_${index}`),
        deliveryCents: dollarsToCents(num(form, `delivery_${index}`)),
        pickupCents: dollarsToCents(num(form, `pickup_${index}`)),
        color: ((ZONE_COLORS as readonly string[]).includes(String(form.get(`color_${index}`)))
          ? form.get(`color_${index}`) : "GRAY") as ZoneColor,
      }));
      next = {
        zones,
        maxMiles: num(form, "maxMiles"),
        center: { lat: num(form, "centerLat"), lon: num(form, "centerLon") },
        method: (form.get("method") === "DRIVING" ? "DRIVING" : "STRAIGHT_LINE") as DistanceMethod,
        showPricesOnWebsite: form.get("showPrices") === "on",
      };
    }
    await saveZoneSettings(session.user.id, next, revision);
  } catch (error) {
    if (error instanceof ZoneSettingsError) return { status: "error", message: error.message };
    return { status: "error", message: "The delivery zones couldn't be saved. Reload and try again." };
  }
  revalidatePath("/desk/settings");
  revalidatePath("/service-area");
  return { status: "saved", message: operation === "restore" ? "Recommended zones restored." : operation === "shop" ? "Center moved to your business address." : "Delivery zones saved. New estimates use them; sent estimates keep theirs." };
}
