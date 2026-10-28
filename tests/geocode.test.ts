import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearGeocodeCache, geocodeAddress, oneLineAddress, parseCensusResponse, GEOCODE_TIMEOUT_MS } from "@/domains/delivery/geocode";
import { startingZoneSettings } from "@/domains/delivery/zone";

vi.mock("@/domains/delivery/settings", () => ({ getZoneSettings: async () => startingZoneSettings() }));
import { checkAddressZone } from "@/domains/delivery/public-check";

// Saved U.S. Census Bureau replies (a public building's address; no customer data). No network in tests.
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/census/${name}.json`, "utf8")) as unknown;
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

beforeEach(() => clearGeocodeCache());

describe("ZONE-1 Census geocoder", () => {
  it("parses a saved reply into a map position, state and ZIP", () => {
    expect(parseCensusResponse(fixture("greeley-city-hall"))).toEqual({
      status: "FOUND", point: { lat: 40.422501212867, lon: -104.694521952776 }, state: "CO", zip: "80631",
    });
    expect(parseCensusResponse(fixture("no-match"))).toEqual({ status: "NO_MATCH" });
    expect(parseCensusResponse({ nonsense: true })).toEqual({ status: "UNAVAILABLE" });
    expect(parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: "a", y: 1 } }] } })).toEqual({ status: "UNAVAILABLE" });
  });

  it("asks the documented endpoint with the current benchmark, JSON and a 5-second timeout", async () => {
    const fetcher = reply(fixture("greeley-city-hall"));
    await geocodeAddress({ line1: "1000 10th St", city: "Greeley", state: "CO", zip: "80631" }, { fetcher });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    expect(parsed.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(parsed.searchParams.get("format")).toBe("json");
    expect(parsed.searchParams.get("address")).toBe("1000 10th St, Greeley, CO 80631");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GEOCODE_TIMEOUT_MS).toBe(5000);
  });

  it("treats a timeout, an error reply or a network failure as unknown, never a guess, and logs nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const timeout = vi.fn(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); });
    expect(await geocodeAddress({ line1: "1000 10th St", zip: "80631" }, { fetcher: timeout })).toEqual({ status: "UNAVAILABLE" });
    expect(await geocodeAddress({ line1: "1000 10th St", zip: "80631" }, { fetcher: reply({}, false) })).toEqual({ status: "UNAVAILABLE" });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("keeps staff lookups for an hour, retries outages, and never keeps public checks", async () => {
    const found = reply(fixture("greeley-city-hall"));
    const address = { line1: "1000 10th St", zip: "80631" };
    await geocodeAddress(address, { fetcher: found, now: 0 });
    await geocodeAddress(address, { fetcher: found, now: 1000 });
    expect(found).toHaveBeenCalledTimes(1);
    await geocodeAddress(address, { fetcher: found, now: 61 * 60 * 1000 });
    expect(found).toHaveBeenCalledTimes(2);
    const publicCheck = reply(fixture("greeley-city-hall"));
    await geocodeAddress({ line1: "2 Main St", zip: "80631" }, { fetcher: publicCheck, keep: false });
    await geocodeAddress({ line1: "2 Main St", zip: "80631" }, { fetcher: publicCheck, keep: false });
    expect(publicCheck).toHaveBeenCalledTimes(2);
    expect(oneLineAddress({ line1: "  1 Main  St ", city: "Greeley", state: "CO", zip: "80631" })).toBe("1 Main St, Greeley, CO 80631");
  });
});

describe("ZONE-1 public address check (no coordinates, no miles, prices only when switched on)", () => {
  const found = (lat: number, lon: number, state = "CO") => async () => ({ status: "FOUND" as const, point: { lat, lon }, state, zip: "80631" });
  it("answers with the zone; the free zone always says free; other prices only when switched on", async () => {
    const local = await checkAddressZone({ line1: "1000 10th St", zip: "80631" }, { lookup: found(40.4225, -104.6945) });
    expect(local).toEqual({ status: "SERVED", zip: "80631", line1: "1000 10th St", zone: "Local — free delivery", free: true, price: null });
    const nearby = await checkAddressZone({ line1: "1 Main St", zip: "80537" }, { lookup: found(40.398, -105.075) });
    expect(nearby).toMatchObject({ status: "SERVED", zone: "Nearby", free: false, price: null });
    const shown = await checkAddressZone({ line1: "1 Main St", zip: "80537" },
      { lookup: found(40.398, -105.075), settings: { ...startingZoneSettings(), showPricesOnWebsite: true } });
    expect(shown).toMatchObject({ price: "$75" });
    expect(JSON.stringify([local, nearby, shown])).not.toMatch(/40\.|104\.|105\.|miles/);
  });
  it("outside the zones or outside Colorado → pickup only; lookup trouble → unknown; bad input → invalid", async () => {
    expect(await checkAddressZone({ line1: "1 Main St", zip: "80401" }, { lookup: found(39.755, -105.221) })).toMatchObject({ status: "OUTSIDE" });
    expect(await checkAddressZone({ line1: "1 Main St", zip: "82001" }, { lookup: found(41.14, -104.82, "WY") })).toMatchObject({ status: "OUTSIDE" });
    expect(await checkAddressZone({ line1: "1 Main St", zip: "80631" }, { lookup: async () => ({ status: "UNAVAILABLE" }) })).toMatchObject({ status: "UNKNOWN" });
    expect(await checkAddressZone({ line1: "1 Main St", zip: "80631" }, { lookup: async () => ({ status: "NO_MATCH" }) })).toMatchObject({ status: "UNKNOWN" });
    expect(await checkAddressZone({ line1: "x", zip: "80631" })).toEqual({ status: "INVALID" });
    expect(await checkAddressZone({ line1: "1 Main St", zip: "8063" })).toEqual({ status: "INVALID" });
  });
});
