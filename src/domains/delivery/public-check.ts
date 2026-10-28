import "server-only";
import { normalizeZip } from "@/domains/site-content/service-area-check";
import { geocodeAddress, type GeocodeResult } from "./geocode";
import { getZoneSettings } from "./settings";
import { zoneForPoint, zonePriceWords, type ZoneSettings } from "./zone";

/**
 * ZONE-1: the public "which zone am I in?" answer. Pure apart from the one lookup. The answer never contains the map
 * position, the miles or anything about taxes; a price appears only when the owner has switched website prices on (a
 * free zone always says it is free — that is the zone's promise). The address is not kept, not even in memory.
 */
export type PublicAddressCheck =
  | { status: "SERVED"; zip: string; line1: string; zone: string; free: boolean; price: string | null }
  | { status: "OUTSIDE" | "UNKNOWN"; zip: string; line1: string }
  | { status: "INVALID" };

export async function checkAddressZone(input: { line1: string; zip: string }, options: {
  lookup?: (address: { line1: string; zip: string; state: string }) => Promise<GeocodeResult>;
  settings?: ZoneSettings;
} = {}): Promise<PublicAddressCheck> {
  const line1 = input.line1.replace(/\s+/g, " ").trim();
  const zip = normalizeZip(input.zip ?? "");
  if (line1.length < 3 || !zip) return { status: "INVALID" };
  const settings = options.settings ?? await getZoneSettings();
  if (settings.method === "DRIVING") return { status: "UNKNOWN", zip, line1 };
  const lookup = options.lookup ?? ((address) => geocodeAddress(address, { keep: false }));
  const found = await lookup({ line1, zip, state: "CO" });
  if (found.status !== "FOUND") return { status: "UNKNOWN", zip, line1 };
  if (found.state && found.state.toUpperCase() !== "CO") return { status: "OUTSIDE", zip, line1 };
  const match = zoneForPoint(found.point, settings);
  if (match.kind === "OUTSIDE") return { status: "OUTSIDE", zip, line1 };
  const free = match.deliveryCents === 0;
  return { status: "SERVED", zip, line1, zone: match.name, free,
    price: !free && settings.showPricesOnWebsite ? zonePriceWords(match.deliveryCents) : null };
}
