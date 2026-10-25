/**
 * ZONE-1: delivery zones measured from one center point (docs/build-specs/screens/SERVICE-AREA-MAP.md sections 1-2).
 * Pure: no database, no network. The settings shape, its validator, great-circle miles and point → zone.
 *
 * Starting values (IN-06, Chris 2026-10-13; straight-line distance confirmed by Chris 2026-10-25):
 *   Local 0–15 miles free · Nearby over 15–30 miles $75 · Extended over 30–50 miles $125 · beyond 50: pickup only.
 * A point exactly on a boundary belongs to the inner (cheaper) zone. Coordinates are internal data: callers must never
 * show them to customers or write them to logs.
 */

export type ZoneColor = "GREEN" | "BLUE" | "AMBER" | "PURPLE" | "GRAY";
export const ZONE_COLORS: readonly ZoneColor[] = ["GREEN", "BLUE", "AMBER", "PURPLE", "GRAY"];
export const ZONE_COLOR_WORDS: Record<ZoneColor, string> = {
  GREEN: "Green", BLUE: "Blue", AMBER: "Amber", PURPLE: "Purple", GRAY: "Gray",
};

export type DeliveryZone = {
  /** Customer-facing name, e.g. "Local — free delivery". */
  name: string;
  /** Outer edge in miles; the zone covers (previous outer, this outer]. */
  outerMiles: number;
  /** Delivery price in integer cents. */
  deliveryCents: number;
  /** Price for us to pick the appliance up at the end of the rental, integer cents. */
  pickupCents: number;
  color: ZoneColor;
};

export type DistanceMethod = "STRAIGHT_LINE" | "DRIVING";
export const DISTANCE_METHODS: readonly DistanceMethod[] = ["STRAIGHT_LINE", "DRIVING"];

export type GeoPoint = { lat: number; lon: number };

export type ZoneSettings = {
  zones: DeliveryZone[];
  maxMiles: number;
  center: GeoPoint;
  method: DistanceMethod;
  showPricesOnWebsite: boolean;
};

export const STARTING_ZONES: readonly DeliveryZone[] = [
  { name: "Local — free delivery", outerMiles: 15, deliveryCents: 0, pickupCents: 0, color: "GREEN" },
  { name: "Nearby", outerMiles: 30, deliveryCents: 7500, pickupCents: 7500, color: "BLUE" },
  { name: "Extended", outerMiles: 50, deliveryCents: 12500, pickupCents: 12500, color: "AMBER" },
];
/** Central Greeley (starting value; owner-editable). */
export const STARTING_CENTER: GeoPoint = { lat: 40.4233, lon: -104.7091 };
export const STARTING_MAX_MILES = 50;
export const STARTING_METHOD: DistanceMethod = "STRAIGHT_LINE";
export const OUTSIDE_NAME = "Outside our delivery area — pickup only";

export function startingZoneSettings(): ZoneSettings {
  return {
    zones: STARTING_ZONES.map((zone) => ({ ...zone })),
    maxMiles: STARTING_MAX_MILES,
    center: { ...STARTING_CENTER },
    method: STARTING_METHOD,
    showPricesOnWebsite: false,
  };
}

const MAX_ZONES = 5;
const MAX_CENTS = 10_000_00;

/** Plain-words problems with a zone setup, or [] when it can be saved. */
export function zoneSettingsProblems(input: Pick<ZoneSettings, "zones" | "maxMiles" | "center" | "method">): string[] {
  const problems: string[] = [];
  const zones = input.zones;
  if (!Array.isArray(zones) || zones.length < 1 || zones.length > MAX_ZONES)
    problems.push(`Have between 1 and ${MAX_ZONES} zones.`);
  if (!Number.isFinite(input.maxMiles) || input.maxMiles <= 0 || input.maxMiles > 200)
    problems.push("The farthest delivery distance must be more than 0 and at most 200 miles.");
  let previous = 0;
  (Array.isArray(zones) ? zones : []).forEach((zone, index) => {
    const label = `Zone ${index + 1}`;
    const name = typeof zone?.name === "string" ? zone.name.trim() : "";
    if (name.length < 2 || name.length > 60) problems.push(`${label}: give it a name of 2 to 60 characters.`);
    if (!Number.isFinite(zone?.outerMiles) || zone.outerMiles <= previous)
      problems.push(`${label}: its outer edge must be farther than the zone before it.`);
    else if (Math.round(zone.outerMiles * 10) !== zone.outerMiles * 10)
      problems.push(`${label}: use miles to one decimal place.`);
    if (!Number.isSafeInteger(zone?.deliveryCents) || zone.deliveryCents < 0 || zone.deliveryCents > MAX_CENTS)
      problems.push(`${label}: the delivery price must be $0 or more.`);
    if (!Number.isSafeInteger(zone?.pickupCents) || zone.pickupCents < 0 || zone.pickupCents > MAX_CENTS)
      problems.push(`${label}: the end-of-rental pickup price must be $0 or more.`);
    if (!ZONE_COLORS.includes(zone?.color)) problems.push(`${label}: choose a color.`);
    if (Number.isFinite(zone?.outerMiles)) previous = Math.max(previous, zone.outerMiles);
  });
  if (Array.isArray(zones) && zones.length && Number.isFinite(input.maxMiles) && previous > input.maxMiles)
    problems.push("The last zone can't reach past the farthest delivery distance.");
  if (!isGeoPoint(input.center)) problems.push("The center must be a real map position.");
  if (!DISTANCE_METHODS.includes(input.method)) problems.push("Choose how distance is measured.");
  return problems;
}

export function isGeoPoint(value: unknown): value is GeoPoint {
  const point = value as GeoPoint | null;
  return !!point && typeof point === "object" && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
    point.lat >= -90 && point.lat <= 90 && point.lon >= -180 && point.lon <= 180;
}

/**
 * Reads the stored settings, falling back to the starting values for anything missing or unreadable (a bad stored
 * value never produces a guessed zone: it produces the starting one, which the owner confirmed).
 */
export function readZoneSettings(source: object | null | undefined): ZoneSettings {
  const start = startingZoneSettings();
  if (!source) return start;
  const row = source as {
    deliveryZones?: unknown; deliveryMaxMiles?: unknown; zoneCenter?: unknown; zoneDistanceMethod?: unknown;
    showDeliveryPricesOnWebsite?: unknown;
  };
  const zones = Array.isArray(row.deliveryZones)
    ? (row.deliveryZones as unknown[]).map((raw) => {
      const zone = (raw ?? {}) as Record<string, unknown>;
      return {
        name: typeof zone.name === "string" ? zone.name : "",
        outerMiles: Number(zone.outerMiles),
        deliveryCents: Number(zone.deliveryCents),
        pickupCents: Number(zone.pickupCents),
        color: (ZONE_COLORS as readonly string[]).includes(String(zone.color)) ? zone.color as ZoneColor : "GRAY",
      };
    })
    : start.zones;
  const candidate: ZoneSettings = {
    zones,
    maxMiles: typeof row.deliveryMaxMiles === "number" ? row.deliveryMaxMiles : start.maxMiles,
    center: isGeoPoint(row.zoneCenter) ? { lat: (row.zoneCenter as GeoPoint).lat, lon: (row.zoneCenter as GeoPoint).lon } : start.center,
    method: (DISTANCE_METHODS as readonly string[]).includes(String(row.zoneDistanceMethod))
      ? row.zoneDistanceMethod as DistanceMethod : start.method,
    showPricesOnWebsite: row.showDeliveryPricesOnWebsite === true,
  };
  if (zoneSettingsProblems(candidate).length) {
    return { ...candidate, zones: start.zones, maxMiles: start.maxMiles };
  }
  return candidate;
}

const EARTH_RADIUS_MILES = 3958.8;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle ("as the crow flies") miles between two points, unrounded. */
export function greatCircleMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const roundMiles = (miles: number) => Math.round(miles * 10) / 10;

export type ZoneMatch =
  | { kind: "ZONE"; zone: number; name: string; miles: number; deliveryCents: number; pickupCents: number; color: ZoneColor }
  | { kind: "OUTSIDE"; zone: null; name: string; miles: number };

/** Miles (already rounded to 0.1) → zone. Exactly on a boundary → the inner zone. */
export function zoneForMiles(miles: number, settings: Pick<ZoneSettings, "zones" | "maxMiles">): ZoneMatch {
  if (!Number.isFinite(miles) || miles < 0) throw new Error("Distance must be zero or more miles.");
  const rounded = roundMiles(miles);
  if (rounded <= settings.maxMiles) {
    const index = settings.zones.findIndex((zone) => rounded <= zone.outerMiles);
    if (index >= 0) {
      const zone = settings.zones[index]!;
      return { kind: "ZONE", zone: index + 1, name: zone.name, miles: rounded, deliveryCents: zone.deliveryCents,
        pickupCents: zone.pickupCents, color: zone.color };
    }
  }
  return { kind: "OUTSIDE", zone: null, name: OUTSIDE_NAME, miles: rounded };
}

/** A map position → zone, measured in a straight line from the center (rounded to 0.1 mile first). */
export function zoneForPoint(point: GeoPoint, settings: Pick<ZoneSettings, "zones" | "maxMiles" | "center">): ZoneMatch {
  if (!isGeoPoint(point)) throw new Error("Not a map position.");
  return zoneForMiles(roundMiles(greatCircleMiles(settings.center, point)), settings);
}

/** "Free" for $0, otherwise "$75" (whole dollars) or "$75.50". */
export function zonePriceWords(cents: number): string {
  if (cents === 0) return "Free";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars.toLocaleString("en-US")}` : `$${dollars.toFixed(2)}`;
}

/** Old band names kept for the driving-route evidence screens (W-24). */
export function bandName(zone: number | null): string {
  if (zone === null) return "MANUAL_ONLY";
  return ["LOCAL", "MIDDLE", "OUTER"][zone - 1] ?? `ZONE_${zone}`;
}
