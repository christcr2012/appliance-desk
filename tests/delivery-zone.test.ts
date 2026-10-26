import { describe, expect, it } from "vitest";
import {
  greatCircleMiles, readZoneSettings, startingZoneSettings, zoneForMiles, zoneForPoint, zonePriceWords,
  zoneSettingsProblems, STARTING_CENTER,
} from "@/domains/delivery/zone";
import { TOWNS, townBySlug, townByName, townsWithZones } from "@/domains/delivery/towns";
import { frozenRouteZones, mileageBand, reviewedDrivingFee } from "@/domains/orders/delivery";
import {
  buildZoneLocation, choiceAllowed, chosenDeliveryCents, confirmZoneByMiles, currentLocations, isPickupOnly,
  readZoneSnapshot, unresolvedDeliveryAddresses, zoneSentence,
} from "@/domains/delivery/snapshot";
import { expectedDeliveryFeeCents } from "@/domains/orders/route-evidence";
import { projectMiles, zoneRangeWords } from "@/domains/delivery/map";

const settings = startingZoneSettings();
const town = (slug: string) => { const t = townBySlug(slug)!; return { lat: t.lat, lon: t.lon }; };
const now = new Date("2026-10-26T15:00:00Z");

describe("ZONE-1 distances and zones (straight line from central Greeley)", () => {
  it("measures known towns like the research list", () => {
    expect(greatCircleMiles(STARTING_CENTER, town("evans"))).toBeCloseTo(3.4, 0);
    expect(greatCircleMiles(STARTING_CENTER, town("loveland"))).toBeCloseTo(19.3, 0);
    expect(greatCircleMiles(STARTING_CENTER, town("boulder"))).toBeCloseTo(40.9, 0);
    expect(greatCircleMiles(STARTING_CENTER, town("golden"))).toBeGreaterThan(50);
  });

  it("puts them in the right zone with the starting prices", () => {
    expect(zoneForPoint(town("evans"), settings)).toMatchObject({ kind: "ZONE", zone: 1, deliveryCents: 0 });
    expect(zoneForPoint(town("loveland"), settings)).toMatchObject({ kind: "ZONE", zone: 2, name: "Nearby", deliveryCents: 7500 });
    expect(zoneForPoint(town("boulder"), settings)).toMatchObject({ kind: "ZONE", zone: 3, name: "Extended", deliveryCents: 12500 });
    expect(zoneForPoint(town("golden"), settings)).toMatchObject({ kind: "OUTSIDE", zone: null });
  });

  it("puts a point exactly on a boundary in the cheaper (inner) zone, after rounding to 0.1 mile", () => {
    expect(zoneForMiles(15.0, settings)).toMatchObject({ zone: 1 });
    expect(zoneForMiles(15.04, settings)).toMatchObject({ zone: 1 });
    expect(zoneForMiles(15.05, settings)).toMatchObject({ zone: 2 });
    expect(zoneForMiles(30, settings)).toMatchObject({ zone: 2 });
    expect(zoneForMiles(50, settings)).toMatchObject({ zone: 3 });
    expect(zoneForMiles(50.1, settings)).toMatchObject({ kind: "OUTSIDE" });
    expect(() => zoneForMiles(-1, settings)).toThrow();
  });

  it("follows the owner's changed zones and farthest distance", () => {
    const changed = { ...settings, zones: settings.zones.map((z, i) => (i === 1 ? { ...z, deliveryCents: 6000, outerMiles: 25 } : z)) };
    expect(zoneForMiles(26, changed)).toMatchObject({ zone: 3 });
    expect(zoneForMiles(20, changed)).toMatchObject({ zone: 2, deliveryCents: 6000 });
    expect(zoneForMiles(45, { ...changed, maxMiles: 40, zones: changed.zones.map((z, i) => (i === 2 ? { ...z, outerMiles: 40 } : z)) }))
      .toMatchObject({ kind: "OUTSIDE" });
  });

  it("keeps the old mileage bands as starting values and reads changed zones", () => {
    expect(mileageBand(15)).toEqual({ allowed: true, amountCents: 0, band: "LOCAL" });
    expect(mileageBand(15.001)).toEqual({ allowed: true, amountCents: 7500, band: "MIDDLE" });
    expect(mileageBand(50)).toEqual({ allowed: true, amountCents: 12500, band: "OUTER" });
    expect(mileageBand(51).allowed).toBe(false);
    const cheaper = { ...settings, zones: settings.zones.map((z) => ({ ...z, deliveryCents: z.deliveryCents / 2 })) };
    expect(mileageBand(40, cheaper).amountCents).toBe(6250);
  });
});

describe("ZONE-1 driving-route proofs keep the bands they were reviewed with", () => {
  const proof = { miles: 22, source: "OWNER_MANUAL_DRIVING_ROUTE", sourceReference: "Map route reviewed by owner",
    measuredAt: "2026-10-26T14:00:00.000Z", origin: "Central Greeley, CO" };
  const at = new Date("2026-10-26T15:00:00Z");
  it("an old proof (no bands) uses the original IN-06 bands; a new one uses its frozen bands, whatever the zones are now", () => {
    expect(reviewedDrivingFee(proof, "Central Greeley, CO", at).amountCents).toBe(7500);
    const frozen = { ...proof, zones: frozenRouteZones({ ...settings, zones: settings.zones.map((z) => ({ ...z, deliveryCents: z.deliveryCents + 500 })) }) };
    expect(reviewedDrivingFee(frozen, "Central Greeley, CO", at).amountCents).toBe(8000);
    expect(() => reviewedDrivingFee({ ...proof, zones: { maxMiles: 50, bands: [] } }, "Central Greeley, CO", at)).toThrow();
  });
});

describe("ZONE-1 approval/signing delivery fee comes from the frozen zone (straight line)", () => {
  const origin = "Central Greeley, CO";
  const at = new Date();
  it("12 straight-line miles / 20 road miles: free in the Local zone, and later zone changes don't change it", () => {
    const local = { ...buildZoneLocation({ serviceAddressId: "a1", settings, now, position: { status: "FOUND",
      point: { lat: STARTING_CENTER.lat + 12 / 69, lon: STARTING_CENTER.lon } } }) };
    expect(local).toMatchObject({ zone: 1, priceCents: 0, choice: "DELIVER" });
    expect(expectedDeliveryFeeCents({ zone: local, routeProof: null, origin: null })).toBe(0);
    // The guard reads only the frozen snapshot, never today's zone settings.
    const pricierToday = startingZoneSettings();
    pricierToday.zones[0]!.deliveryCents = 5000;
    expect(expectedDeliveryFeeCents({ zone: local, routeProof: null, origin: null })).toBe(0);
    // Only an explicitly recorded driving-route exception uses road miles (with its own frozen bands).
    const proof = { miles: 20, source: "OWNER_MANUAL_DRIVING_ROUTE", sourceReference: "Owner-recorded road route",
      measuredAt: new Date(at.getTime() - 60_000).toISOString(), origin };
    expect(expectedDeliveryFeeCents({ zone: local, routeProof: proof, origin })).toBe(7500);
  });
  it("pickup is $0; an unknown or outside zone can't be priced (refused)", () => {
    const unknown = buildZoneLocation({ serviceAddressId: "a1", settings, now, position: { status: "UNAVAILABLE" } });
    expect(() => expectedDeliveryFeeCents({ zone: unknown, routeProof: null, origin: null })).toThrow(/Confirm the delivery zone/);
    expect(expectedDeliveryFeeCents({ zone: { ...unknown, choice: "CUSTOMER_PICKUP" }, routeProof: null, origin: null })).toBe(0);
    expect(() => expectedDeliveryFeeCents({ zone: null, routeProof: null, origin: null })).toThrow();
  });
  it("lists addresses that would be delivered without a known zone", () => {
    const unknown = buildZoneLocation({ serviceAddressId: "a1", settings, now, position: { status: "UNAVAILABLE" } });
    const known = buildZoneLocation({ serviceAddressId: "a2", settings, now, position: { status: "FOUND", point: town("evans") } });
    const raw = { version: 1, locations: [unknown, known] };
    expect(unresolvedDeliveryAddresses(raw, ["a1", "a2", "a3"])).toEqual(["a1", "a3"]);
    expect(unresolvedDeliveryAddresses({ version: 1, locations: [{ ...unknown, choice: "CUSTOMER_PICKUP" }, known] }, ["a1", "a2"])).toEqual([]);
    expect(unresolvedDeliveryAddresses(null, ["a1"])).toEqual([]);
  });
});

describe("ZONE-1 removed addresses", () => {
  it("are never shown or used", () => {
    const row = (id: string, choice: "DELIVER" | "CUSTOMER_PICKUP") => ({
      ...buildZoneLocation({ serviceAddressId: id, settings, now, position: { status: "FOUND", point: town("evans") } }), choice });
    const raw = { version: 1, locations: [row("a1", "CUSTOMER_PICKUP"), row("gone", "DELIVER")] };
    expect(currentLocations(raw, ["a1", null]).map((r) => r.serviceAddressId)).toEqual(["a1"]);
    expect(isPickupOnly(raw, ["a1"])).toBe(true);
    expect(isPickupOnly(raw, ["a1", "gone"])).toBe(false);
    expect(isPickupOnly(raw, [])).toBe(false);
  });
});

describe("ZONE-1 settings validation", () => {
  it("accepts the starting values", () => {
    expect(zoneSettingsProblems(settings)).toEqual([]);
  });
  it("refuses zones that don't increase, negative prices, a last zone past the farthest distance and bad centers", () => {
    const bad = { ...settings, zones: [settings.zones[1]!, settings.zones[0]!, settings.zones[2]!] };
    expect(zoneSettingsProblems(bad).join(" ")).toMatch(/farther than the zone before/);
    expect(zoneSettingsProblems({ ...settings, zones: [{ ...settings.zones[0]!, deliveryCents: -1 }] }).join(" ")).toMatch(/\$0 or more/);
    expect(zoneSettingsProblems({ ...settings, maxMiles: 40 }).join(" ")).toMatch(/past the farthest/);
    expect(zoneSettingsProblems({ ...settings, center: { lat: 99, lon: 0 } }).join(" ")).toMatch(/map position/);
    expect(zoneSettingsProblems({ ...settings, zones: [] }).join(" ")).toMatch(/between 1 and 5/);
    expect(zoneSettingsProblems({ ...settings, zones: [{ ...settings.zones[0]!, name: "" }] }).join(" ")).toMatch(/name/);
  });
  it("reads stored settings and falls back to the starting values for anything unreadable", () => {
    expect(readZoneSettings(null)).toEqual(settings);
    expect(readZoneSettings({ deliveryZones: "nonsense" })).toEqual(settings);
    expect(readZoneSettings({ deliveryZones: [{ name: "Only", outerMiles: 10, deliveryCents: 0, pickupCents: 0, color: "GREEN" }],
      deliveryMaxMiles: 10, showDeliveryPricesOnWebsite: true, zoneDistanceMethod: "DRIVING" }))
      .toMatchObject({ maxMiles: 10, method: "DRIVING", showPricesOnWebsite: true, zones: [{ name: "Only" }] });
  });
  it("words prices plainly", () => {
    expect(zonePriceWords(0)).toBe("Free");
    expect(zonePriceWords(7500)).toBe("$75");
    expect(zonePriceWords(7550)).toBe("$75.50");
  });
});

describe("ZONE-1 town list", () => {
  it("has unique slugs, every place from the research list within 50 miles, and Greeley at the center", () => {
    expect(new Set(TOWNS.map((t) => t.slug)).size).toBe(TOWNS.length);
    for (const name of ["Garden City", "Evans", "Windsor", "Loveland", "Fort Collins", "Longmont", "Brighton", "Thornton",
      "Boulder", "Broomfield", "Denver", "Aurora", "Estes Park", "Fort Morgan", "Golden"]) expect(townByName(name), name).not.toBeNull();
    const list = townsWithZones(settings);
    expect(list[0]).toMatchObject({ name: "Greeley", miles: 0 });
    expect(list.find((t) => t.slug === "loveland")!.zone).toMatchObject({ zone: 2 });
  });
  it("draws to scale: 10 miles east of the center is 10 units right", () => {
    const p = projectMiles({ lat: STARTING_CENTER.lat, lon: STARTING_CENTER.lon + 10 / (69 * Math.cos(STARTING_CENTER.lat * Math.PI / 180)) }, STARTING_CENTER);
    expect(p.x).toBeCloseTo(10, 1);
    expect(projectMiles({ lat: STARTING_CENTER.lat + 1, lon: STARTING_CENTER.lon }, STARTING_CENTER).y).toBeCloseTo(-69, 0);
    expect(zoneRangeWords(settings.zones, 0)).toBe("0–15");
    expect(zoneRangeWords(settings.zones, 1)).toBe("15–30");
  });
});

describe("ZONE-1 estimate snapshot (pure)", () => {
  const base = { serviceAddressId: "addr-1", settings, now };
  it("stores zone, miles, method, center and both prices; delivery is the default choice", () => {
    const row = buildZoneLocation({ ...base, position: { status: "FOUND", point: town("loveland") } });
    expect(row).toMatchObject({ zone: 2, name: "Nearby", method: "STRAIGHT_LINE", center: STARTING_CENTER, priceCents: 7500,
      pickupPriceCents: 7500, choice: "DELIVER", checkedAt: now.toISOString() });
    expect(row.miles).toBeCloseTo(19.3, 0);
    expect(zoneSentence(row)).toMatch(/^Your address is in our Nearby zone \(19\.\d miles\): delivery \$75\.$/);
    expect(chosenDeliveryCents(row)).toBe(7500);
    expect(chosenDeliveryCents({ ...row, choice: "CUSTOMER_PICKUP" })).toBe(0);
  });
  it("offers only pickup outside the area or outside Colorado", () => {
    const outside = buildZoneLocation({ ...base, position: { status: "FOUND", point: town("golden") } });
    expect(outside).toMatchObject({ zone: "OUTSIDE", choice: "CUSTOMER_PICKUP", priceCents: null });
    expect(choiceAllowed(outside, "DELIVER")).toBe(false);
    expect(choiceAllowed(outside, "CUSTOMER_PICKUP")).toBe(true);
    expect(buildZoneLocation({ ...base, position: { status: "OUT_OF_STATE" } })).toMatchObject({ zone: "OUTSIDE" });
  });
  it("never guesses: a failed lookup or driving distance is unknown until staff type the miles", () => {
    const unknown = buildZoneLocation({ ...base, position: { status: "UNAVAILABLE" } });
    expect(unknown).toMatchObject({ zone: "UNKNOWN", priceCents: null, miles: null });
    expect(zoneSentence(unknown)).toBe("We'll confirm your delivery price.");
    expect(buildZoneLocation({ ...base, settings: { ...settings, method: "DRIVING" }, position: { status: "FOUND", point: town("evans") } }))
      .toMatchObject({ zone: "UNKNOWN" });
    const settled = confirmZoneByMiles(unknown, { miles: 22, reason: "Measured on a paper map", userId: "u1", settings, now });
    expect(settled).toMatchObject({ zone: 2, method: "STAFF_MILES", priceCents: 7500, confirmed: { userId: "u1", reason: "Measured on a paper map" } });
    expect(() => confirmZoneByMiles(settled, { miles: 5, reason: "again please", userId: "u1", settings, now })).toThrow(/already/);
    expect(() => confirmZoneByMiles(unknown, { miles: 5, reason: "x", userId: "u1", settings, now })).toThrow(/how you measured/);
  });
  it("reads only well-formed snapshots", () => {
    expect(readZoneSnapshot(null)).toBeNull();
    expect(readZoneSnapshot({ version: 2, locations: [] })).toBeNull();
    const row = buildZoneLocation({ ...base, position: { status: "FOUND", point: town("evans") } });
    expect(readZoneSnapshot({ version: 1, locations: [row, { serviceAddressId: 3 }] })?.locations).toEqual([row]);
  });
});
