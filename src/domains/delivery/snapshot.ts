import { OUTSIDE_NAME, zoneForMiles, zoneForPoint, zonePriceWords, type DistanceMethod, type GeoPoint, type ZoneSettings } from "./zone";

/**
 * ZONE-1: the delivery zone frozen onto an estimate (one entry per delivery address) and copied to its agreement.
 * Pure. Spec shape { zone, name, miles, method, center, priceCents, pickupPriceCents }, plus the address it is for,
 * the delivery choice and how an unknown zone was settled. Prices are integer cents from the owner's zones.
 *
 *   zone: 1..n   a delivery zone          priceCents = its delivery price (0 = free)
 *   "OUTSIDE"    beyond the last zone, or outside Colorado: no delivery, pickup only
 *   "UNKNOWN"    the address couldn't be placed on the map: "We'll confirm your delivery price" (never a guess)
 */
export type DeliveryChoice = "DELIVER" | "CUSTOMER_PICKUP";
export type SnapshotMethod = DistanceMethod | "STAFF_MILES";
export type ZoneSnapshotLocation = {
  serviceAddressId: string;
  zone: number | "OUTSIDE" | "UNKNOWN";
  name: string;
  miles: number | null;
  method: SnapshotMethod;
  center: GeoPoint;
  priceCents: number | null;
  pickupPriceCents: number | null;
  choice: DeliveryChoice;
  /** Why the zone is unknown, in plain words for staff (never shown to customers). */
  unknownReason?: string;
  /** Staff typed the miles because the lookup couldn't place the address. */
  confirmed?: { userId: string; reason: string; at: string };
  /** "I'll pick it up": when and where the pickup was arranged (closes the To do). */
  pickupArranged?: { userId: string; note: string; at: string };
  /** Pickup was chosen on a quote that already charged delivery: a new reviewed quote without delivery is needed. */
  requote?: { at: string; by: "STAFF" | "CUSTOMER" };
  checkedAt: string;
};
export type EstimateZoneSnapshot = { version: 1; locations: ZoneSnapshotLocation[] };

export type PositionInput =
  | { status: "FOUND"; point: GeoPoint }
  | { status: "OUT_OF_STATE" }
  | { status: "NO_MATCH" }
  | { status: "UNAVAILABLE" };

const UNKNOWN_WORDS: Record<"NO_MATCH" | "UNAVAILABLE" | "DRIVING", string> = {
  NO_MATCH: "The address lookup couldn't find this address on the map.",
  UNAVAILABLE: "The address lookup didn't answer. Try again later, or type the miles.",
  DRIVING: "Zones are set to driving distance, which is typed in by hand.",
};

/** One address's zone from its map position and the current zones. Keeps an earlier delivery choice when allowed. */
export function buildZoneLocation(input: {
  serviceAddressId: string; position: PositionInput; settings: ZoneSettings; now: Date; previousChoice?: DeliveryChoice;
}): ZoneSnapshotLocation {
  const { settings, position } = input;
  const base = { serviceAddressId: input.serviceAddressId, center: settings.center, checkedAt: input.now.toISOString() };
  if (position.status === "OUT_OF_STATE") {
    return { ...base, zone: "OUTSIDE", name: OUTSIDE_NAME, miles: null, method: settings.method, priceCents: null,
      pickupPriceCents: null, choice: "CUSTOMER_PICKUP" };
  }
  if (position.status !== "FOUND" || settings.method === "DRIVING") {
    const why = settings.method === "DRIVING" ? "DRIVING" : position.status === "FOUND" ? "UNAVAILABLE" : position.status;
    return { ...base, zone: "UNKNOWN", name: "Delivery price to be confirmed", miles: null, method: settings.method,
      priceCents: null, pickupPriceCents: null, choice: input.previousChoice ?? "DELIVER", unknownReason: UNKNOWN_WORDS[why] };
  }
  const match = zoneForPoint(position.point, settings);
  return fromMatch(base, match, settings.method, input.previousChoice);
}

function fromMatch(base: Pick<ZoneSnapshotLocation, "serviceAddressId" | "center" | "checkedAt">,
  match: ReturnType<typeof zoneForMiles>, method: SnapshotMethod, previousChoice?: DeliveryChoice): ZoneSnapshotLocation {
  if (match.kind === "OUTSIDE") {
    return { ...base, zone: "OUTSIDE", name: match.name, miles: match.miles, method, priceCents: null,
      pickupPriceCents: null, choice: "CUSTOMER_PICKUP" };
  }
  return { ...base, zone: match.zone, name: match.name, miles: match.miles, method, priceCents: match.deliveryCents,
    pickupPriceCents: match.pickupCents, choice: previousChoice ?? "DELIVER" };
}

/** Staff settles an unknown zone by typing the miles (with a reason, audited by the caller). */
export function confirmZoneByMiles(location: ZoneSnapshotLocation, input: {
  miles: number; reason: string; userId: string; settings: ZoneSettings; now: Date;
}): ZoneSnapshotLocation {
  if (location.zone !== "UNKNOWN") throw new Error("This address already has a delivery zone.");
  if (!Number.isFinite(input.miles) || input.miles < 0 || input.miles > 500) throw new Error("Enter the miles, from 0 to 500.");
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 5 || reason.length > 300) throw new Error("Say how you measured it (5 to 300 characters).");
  const match = zoneForMiles(input.miles, input.settings);
  const settled = fromMatch({ serviceAddressId: location.serviceAddressId, center: input.settings.center,
    checkedAt: input.now.toISOString() }, match, "STAFF_MILES", location.choice);
  return { ...settled, confirmed: { userId: input.userId, reason, at: input.now.toISOString() } };
}

/** Delivery is always optional; outside the area only the pickup choice exists. */
export function choiceAllowed(location: ZoneSnapshotLocation, choice: DeliveryChoice): boolean {
  if (choice === "CUSTOMER_PICKUP") return true;
  return location.zone !== "OUTSIDE";
}

export function readZoneSnapshot(raw: unknown): EstimateZoneSnapshot | null {
  const value = raw as EstimateZoneSnapshot | null;
  if (!value || value.version !== 1 || !Array.isArray(value.locations)) return null;
  const locations = value.locations.filter((row) => row && typeof row.serviceAddressId === "string" &&
    (row.zone === "OUTSIDE" || row.zone === "UNKNOWN" || Number.isSafeInteger(row.zone)) &&
    (row.choice === "DELIVER" || row.choice === "CUSTOMER_PICKUP"));
  return { version: 1, locations };
}

/** Only the entries for addresses still on the estimate's lines (a removed line's address is never shown or used). */
export function currentLocations(raw: unknown, addressIds: Iterable<string | null | undefined>): ZoneSnapshotLocation[] {
  const current = new Set([...addressIds].filter((id): id is string => !!id));
  return readZoneSnapshot(raw)?.locations.filter((row) => current.has(row.serviceAddressId)) ?? [];
}

/**
 * Current addresses that would be delivered without a known zone (no entry, or "UNKNOWN" and not pickup). Approval and
 * conversion refuse while any remain, so the "Confirm the delivery zone" To do can never be dropped unresolved.
 * An estimate that never had its zone checked (raw is null, older estimates) has none.
 */
export function unresolvedDeliveryAddresses(raw: unknown, addressIds: Iterable<string | null | undefined>): string[] {
  const snapshot = readZoneSnapshot(raw);
  if (!snapshot) return [];
  const ids = [...new Set([...addressIds].filter((id): id is string => !!id))];
  return ids.filter((id) => {
    const row = snapshot.locations.find((location) => location.serviceAddressId === id);
    return !row || (row.zone === "UNKNOWN" && row.choice !== "CUSTOMER_PICKUP");
  });
}

export const UNRESOLVED_ZONE_MESSAGE =
  "Confirm the delivery zone for every address first (or set it to pickup) — the delivery price isn't known yet.";

/**
 * The delivery fee the frozen order must show for one address: the zone price frozen on the estimate (0 for pickup).
 * null when the zone isn't known (refuse). A recorded driving-route exception is checked separately with its own bands.
 */
export function expectedZoneDeliveryCents(location: ZoneSnapshotLocation | null | undefined): number | null {
  if (!location) return null;
  if (location.choice === "CUSTOMER_PICKUP") return 0;
  return location.zone === "UNKNOWN" || location.zone === "OUTSIDE" ? null : location.priceCents;
}

/** True when every current address is "I'll pick it up" (no delivery window needed). */
export function isPickupOnly(raw: unknown, addressIds: Iterable<string | null | undefined>): boolean {
  const rows = currentLocations(raw, addressIds);
  return rows.length > 0 && rows.every((row) => row.choice === "CUSTOMER_PICKUP");
}

export function snapshotLocation(raw: unknown, serviceAddressId: string): ZoneSnapshotLocation | null {
  return readZoneSnapshot(raw)?.locations.find((row) => row.serviceAddressId === serviceAddressId) ?? null;
}

/** What the customer pays now for this address's delivery: the zone price, $0 for pickup, null while unknown. */
export function chosenDeliveryCents(location: ZoneSnapshotLocation): number | null {
  if (location.choice === "CUSTOMER_PICKUP") return 0;
  return location.priceCents;
}

/** The customer-facing sentence, e.g. "Your address is in our Nearby zone (22 miles): delivery $75." */
export function zoneSentence(location: ZoneSnapshotLocation): string {
  if (location.zone === "UNKNOWN") return "We'll confirm your delivery price.";
  if (location.zone === "OUTSIDE") return "This address is outside our delivery area — you can still rent and pick it up.";
  const miles = location.miles === null ? "" : ` (${formatMiles(location.miles)})`;
  const price = location.priceCents === 0 ? "free delivery" : `delivery ${zonePriceWords(location.priceCents ?? 0)}`;
  return `Your address is in our ${location.name} zone${miles}: ${price}.`;
}

export function formatMiles(miles: number): string {
  const rounded = Math.round(miles * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${rounded === 1 ? "mile" : "miles"}`;
}
