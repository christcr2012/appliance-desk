import "server-only";
import { isGeoPoint, type GeoPoint } from "./zone";

/**
 * ZONE-1: address → map position with the U.S. Census Bureau geocoder (free, no key, official).
 * https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html (accessed 2026-10-25).
 *
 * Server only. 5-second timeout. Never logs the address or the position. A failure of any kind is "unknown", never a
 * guess. Staff lookups are kept in a small in-memory cache for an hour so the same address isn't looked up twice in a
 * row, and customer addresses are kept on their own row (address-zone.ts) so they are looked up once. Public checks
 * (keep: false) are never kept anywhere.
 */

export const CENSUS_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const CENSUS_BENCHMARK = "Public_AR_Current";
export const GEOCODE_TIMEOUT_MS = 5_000;
export const GEOCODE_SOURCE = "CENSUS";

export type GeocodeAddress = { line1: string; city?: string | null; state?: string | null; zip?: string | null };
export type GeocodeResult =
  | { status: "FOUND"; point: GeoPoint; state: string | null; zip: string | null }
  | { status: "NO_MATCH" }
  | { status: "UNAVAILABLE" };

const collapse = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** One line, e.g. "1000 10th St, Greeley, CO 80631". Also the cache key (upper-cased). */
export function oneLineAddress(address: GeocodeAddress): string {
  const line1 = collapse(address.line1);
  const city = collapse(address.city);
  const stateZip = [collapse(address.state), collapse(address.zip)].filter(Boolean).join(" ");
  return [line1, city, stateZip].filter(Boolean).join(", ").slice(0, 300);
}

/** Reads a Census "onelineaddress" JSON reply. Exported for the saved-fixture tests. */
export function parseCensusResponse(body: unknown): GeocodeResult {
  const matches = (body as { result?: { addressMatches?: unknown } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches)) return { status: "UNAVAILABLE" };
  const first = matches[0] as {
    coordinates?: { x?: unknown; y?: unknown };
    addressComponents?: { state?: unknown; zip?: unknown };
  } | undefined;
  if (!first) return { status: "NO_MATCH" };
  const point = { lat: Number(first.coordinates?.y), lon: Number(first.coordinates?.x) };
  if (!isGeoPoint(point)) return { status: "UNAVAILABLE" };
  const state = typeof first.addressComponents?.state === "string" ? first.addressComponents.state : null;
  const zip = typeof first.addressComponents?.zip === "string" ? first.addressComponents.zip : null;
  return { status: "FOUND", point, state, zip };
}

type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; cache: "no-store" }) =>
  Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Browser tests only (playwright.config.ts sets CENSUS_GEOCODER_FIXTURES=1 for its local server): answer from fixed
 * public town centers by ZIP instead of calling the Census Bureau, so CI never depends on an outside service. Never on
 * Vercel (VERCEL is set on every Vercel build and deployment), so it can't affect a real lookup.
 */
function browserTestFixturesOn() {
  return process.env.CENSUS_GEOCODER_FIXTURES === "1" && !process.env.VERCEL;
}
const BROWSER_TEST_POINTS: Record<string, { y: number; x: number }> = {
  "80631": { y: 40.4225, x: -104.6945 }, // Greeley
  "80537": { y: 40.398, x: -105.075 }, // Loveland
  "80401": { y: 39.755, x: -105.221 }, // Golden
};
const browserTestFetcher: Fetcher = async (target) => {
  const zip = /(\d{5})\s*$/.exec(new URL(target).searchParams.get("address") ?? "")?.[1] ?? "";
  const point = BROWSER_TEST_POINTS[zip];
  return { ok: true, json: async () => ({ result: { addressMatches: point
    ? [{ coordinates: point, addressComponents: { state: "CO", zip } }] : [] } }) };
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; result: GeocodeResult }>();

/** Tests only: start from an empty cache. */
export function clearGeocodeCache() {
  cache.clear();
}

/**
 * Looks one address up. `fetcher` exists for tests (saved fixtures; no network in CI). Only FOUND and NO_MATCH are
 * cached; an outage is retried next time.
 */
export async function geocodeAddress(address: GeocodeAddress,
  options: { fetcher?: Fetcher; now?: number; keep?: boolean } = {}): Promise<GeocodeResult> {
  const line = oneLineAddress(address);
  if (collapse(address.line1).length < 3 || line.length < 8) return { status: "NO_MATCH" };
  const key = line.toUpperCase();
  const now = options.now ?? Date.now();
  // The public address checker passes keep: false — its addresses are never kept, not even in memory.
  const keep = options.keep !== false;
  const cached = keep ? cache.get(key) : undefined;
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;

  const url = `${CENSUS_ENDPOINT}?${new URLSearchParams({ address: line, benchmark: CENSUS_BENCHMARK, format: "json" })}`;
  const fetcher: Fetcher = options.fetcher ?? (browserTestFixturesOn() ? browserTestFetcher : (target, init) => fetch(target, init));
  let result: GeocodeResult;
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    result = response.ok ? parseCensusResponse(await response.json()) : { status: "UNAVAILABLE" };
  } catch {
    // Timeout, network or bad JSON. Deliberately not logged: the message could contain the address.
    result = { status: "UNAVAILABLE" };
  }
  if (keep && result.status !== "UNAVAILABLE") {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now, result });
  }
  return result;
}
