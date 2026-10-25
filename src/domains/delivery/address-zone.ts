import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { geocodeAddress, oneLineAddress, GEOCODE_SOURCE, type GeocodeResult } from "./geocode";
import { isGeoPoint, type GeoPoint } from "./zone";

/**
 * ZONE-1: the map position of a customer's service address, looked up once and kept in ServiceAddressGeocode.
 * Looked up again only when the street changes (the stored hash no longer matches). Internal only: the position is
 * returned to delivery code, never put in a page, a customer's data or a log.
 */

export type AddressPosition =
  | { status: "FOUND"; point: GeoPoint; source: string }
  | { status: "OUT_OF_STATE" }
  | { status: "NO_MATCH" }
  | { status: "UNAVAILABLE" };

type AddressRow = { id: string; line1: string; city: string; state: string; zip: string };

export function addressHash(address: Omit<AddressRow, "id">): string {
  return createHash("sha256").update(oneLineAddress(address).toUpperCase()).digest("hex");
}

type Options = { geocode?: (address: Omit<AddressRow, "id">) => Promise<GeocodeResult>; actorId?: string | null };

/** Out of Colorado is decided from the address itself, with no lookup (delivery is Colorado only). */
export async function locateServiceAddresses(addressIds: readonly string[], options: Options = {}):
  Promise<Map<string, AddressPosition>> {
  const ids = [...new Set(addressIds)].slice(0, 100);
  const result = new Map<string, AddressPosition>();
  if (!ids.length) return result;
  const rows = await prisma.serviceAddress.findMany({
    where: { id: { in: ids } },
    select: { id: true, line1: true, city: true, state: true, zip: true,
      geocode: { select: { latitude: true, longitude: true, addressHash: true, source: true } } },
  });
  const lookup = options.geocode ?? ((address) => geocodeAddress(address));
  for (const row of rows) {
    if (row.state.trim().toUpperCase() !== "CO") { result.set(row.id, { status: "OUT_OF_STATE" }); continue; }
    const hash = addressHash(row);
    const kept = row.geocode;
    const keptPoint = kept ? { lat: kept.latitude, lon: kept.longitude } : null;
    if (kept && keptPoint && isGeoPoint(keptPoint) && kept.addressHash === hash) {
      result.set(row.id, { status: "FOUND", point: keptPoint, source: kept.source });
      continue;
    }
    const found = await lookup({ line1: row.line1, city: row.city, state: row.state, zip: row.zip });
    if (found.status !== "FOUND") { result.set(row.id, { status: found.status }); continue; }
    if (found.state && found.state.toUpperCase() !== "CO") { result.set(row.id, { status: "OUT_OF_STATE" }); continue; }
    await prisma.serviceAddressGeocode.upsert({
      where: { serviceAddressId: row.id },
      create: { serviceAddressId: row.id, latitude: found.point.lat, longitude: found.point.lon, addressHash: hash,
        source: GEOCODE_SOURCE, geocodedAt: new Date(), geocodedByUserId: options.actorId ?? null },
      update: { latitude: found.point.lat, longitude: found.point.lon, addressHash: hash, source: GEOCODE_SOURCE,
        geocodedAt: new Date(), geocodedByUserId: options.actorId ?? null },
    });
    result.set(row.id, { status: "FOUND", point: found.point, source: GEOCODE_SOURCE });
  }
  return result;
}
