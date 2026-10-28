import { greatCircleMiles, roundMiles, zoneForMiles, type GeoPoint, type ZoneMatch, type ZoneSettings } from "./zone";

/**
 * ZONE-1: towns and places within (and just past) 50 miles of central Greeley, for the website map, the town list and
 * the /rent/{town} pages. Source: docs/research/2026-10-25-tax-jurisdictions-50mi.md (accessed 2026-10-25), with
 * approximate town centers (about ±1 mile). A town's zone here is only a guide for the list: the address checker and
 * estimates always measure the customer's own address.
 *
 * These are public place centers (not customer data). `label` marks the towns named on the map drawing; every town is
 * in the text list. `unincorporated` places have no town government (county rules apply).
 */
export type Town = {
  name: string;
  slug: string;
  lat: number;
  lon: number;
  county: string;
  label?: boolean;
  unincorporated?: boolean;
};

type Row = [name: string, lat: number, lon: number, county: string, flags?: "label" | "uninc"];

const ROWS: Row[] = [
  ["Greeley", 40.4233, -104.7091, "Weld", "label"],
  ["Garden City", 40.395, -104.688, "Weld"],
  ["Evans", 40.376, -104.692, "Weld", "label"],
  ["Lucerne", 40.48, -104.69, "Weld", "uninc"],
  ["La Salle", 40.349, -104.702, "Weld"],
  ["Eaton", 40.531, -104.711, "Weld", "label"],
  ["Kersey", 40.387, -104.562, "Weld", "label"],
  ["Galeton", 40.52, -104.58, "Weld", "uninc"],
  ["Milliken", 40.329, -104.855, "Weld"],
  ["Severance", 40.524, -104.851, "Weld"],
  ["Gilcrest", 40.282, -104.778, "Weld"],
  ["Windsor", 40.477, -104.901, "Weld", "label"],
  ["Ault", 40.582, -104.732, "Weld", "label"],
  ["Johnstown", 40.337, -104.912, "Weld", "label"],
  ["Pierce", 40.636, -104.755, "Weld"],
  ["Platteville", 40.215, -104.823, "Weld", "label"],
  ["Timnath", 40.529, -104.985, "Larimer"],
  ["Loveland", 40.398, -105.075, "Larimer", "label"],
  ["Nunn", 40.706, -104.783, "Weld", "label"],
  ["Mead", 40.233, -104.999, "Weld"],
  ["Berthoud", 40.308, -105.081, "Larimer", "label"],
  ["Fort Collins", 40.585, -105.084, "Larimer", "label"],
  ["Keenesburg", 40.108, -104.52, "Weld", "label"],
  ["Fort Lupton", 40.085, -104.813, "Weld", "label"],
  ["Hudson", 40.073, -104.643, "Weld"],
  ["Firestone", 40.112, -104.937, "Weld"],
  ["Wellington", 40.704, -105.009, "Larimer", "label"],
  ["Frederick", 40.099, -104.937, "Weld"],
  ["Dacono", 40.085, -104.94, "Weld"],
  ["Longmont", 40.167, -105.102, "Boulder", "label"],
  ["Lochbuie", 40.007, -104.716, "Weld"],
  ["Brighton", 39.985, -104.82, "Adams", "label"],
  ["Erie", 40.05, -105.05, "Boulder"],
  ["Lyons", 40.225, -105.271, "Boulder", "label"],
  ["Niwot", 40.104, -105.171, "Boulder", "uninc"],
  ["Lafayette", 39.994, -105.09, "Boulder"],
  ["Wiggins", 40.23, -104.07, "Morgan", "label"],
  ["Louisville", 39.978, -105.132, "Boulder"],
  ["Northglenn", 39.896, -104.981, "Adams"],
  ["Grover", 40.87, -104.225, "Weld"],
  ["Broomfield", 39.92, -105.087, "Broomfield"],
  ["Superior", 39.953, -105.169, "Boulder"],
  ["Thornton", 39.868, -104.972, "Adams", "label"],
  ["Boulder", 40.015, -105.27, "Boulder", "label"],
  ["Jamestown", 40.116, -105.388, "Boulder"],
  ["Federal Heights", 39.851, -105.015, "Adams"],
  ["Estes Park", 40.377, -105.521, "Larimer", "label"],
  ["Westminster", 39.837, -105.037, "Adams"],
  ["Commerce City", 39.808, -104.934, "Adams"],
  ["Arvada", 39.803, -105.087, "Jefferson"],
  ["New Raymer", 40.61, -103.84, "Weld"],
  ["Log Lane Village", 40.27, -103.83, "Morgan"],
  ["Lakeside", 39.78, -105.06, "Jefferson"],
  ["Bennett", 39.759, -104.427, "Adams"],
  ["Aurora", 39.729, -104.832, "Arapahoe"],
  ["Mountain View", 39.774, -105.057, "Jefferson"],
  ["Ward", 40.072, -105.509, "Boulder"],
  ["Fort Morgan", 40.25, -103.8, "Morgan", "label"],
  ["Wheat Ridge", 39.766, -105.077, "Jefferson"],
  ["Denver", 39.739, -104.99, "Denver", "label"],
  ["Edgewater", 39.753, -105.064, "Jefferson"],
  ["Glendale", 39.705, -104.934, "Arapahoe"],
  ["Nederland", 39.961, -105.511, "Boulder"],
  ["Lakewood", 39.705, -105.081, "Jefferson"],
  ["Golden", 39.755, -105.221, "Jefferson"],
];

export function townSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export const TOWNS: readonly Town[] = ROWS.map(([name, lat, lon, county, flag]) => ({
  name, slug: townSlug(name), lat, lon, county,
  ...(flag === "label" ? { label: true } : {}),
  ...(flag === "uninc" ? { unincorporated: true } : {}),
}));

export function townBySlug(slug: string): Town | null {
  return TOWNS.find((town) => town.slug === slug) ?? null;
}

export function townByName(name: string | null | undefined): Town | null {
  if (!name) return null;
  const wanted = name.replace(/\s+/g, " ").trim().toLowerCase();
  return TOWNS.find((town) => town.name.toLowerCase() === wanted) ?? null;
}

export type TownWithZone = Town & { miles: number; zone: ZoneMatch };

/** Every town with its straight-line miles from the center and the zone its center falls in, nearest first. */
export function townsWithZones(settings: Pick<ZoneSettings, "zones" | "maxMiles" | "center">): TownWithZone[] {
  return TOWNS.map((town) => {
    const point: GeoPoint = { lat: town.lat, lon: town.lon };
    const miles = roundMiles(greatCircleMiles(settings.center, point));
    return { ...town, miles, zone: zoneForMiles(miles, settings) };
  }).sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
}
