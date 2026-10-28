import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { geocodeAddress, oneLineAddress, GEOCODE_SOURCE, type GeocodeResult } from "./geocode";
import { isGeoPoint, roundGeoPoint, type GeoPoint } from "./zone";

/**
 * ZONE-1: the map position of a customer's service address, looked up once and kept in ServiceAddressGeocode.
 * Looked up again only when the street changes (the stored hash no longer matches). Internal only: the position is
 * returned to delivery code, never put in a page, a customer's data or a log.
 *
 * Two steps so the outside call never runs inside a database transaction and nothing is written without a
 * re-checked actor: `locateServiceAddresses` reads and calls the Census lookup (no writes); the caller then saves the
 * new positions with `saveLookedUpPositionsInTx` inside its own transaction, after `assertActiveTeamActor`.
 */

export type AddressPosition =
  | { status: "FOUND"; point: GeoPoint; source: string }
  | { status: "OUT_OF_STATE" }
  | { status: "NO_MATCH" }
  | { status: "UNAVAILABLE" };

type AddressRow = { id: string; line1: string; city: string; state: string; zip: string };
export type LookedUpPosition = { serviceAddressId: string; point: GeoPoint; addressHash: string };

export function addressHash(address: Omit<AddressRow, "id">): string {
  return createHash("sha256").update(oneLineAddress(address).toUpperCase()).digest("hex");
}

type Options = { geocode?: (address: Omit<AddressRow, "id">) => Promise<GeocodeResult> };

/** Out of Colorado is decided from the address itself, with no lookup (delivery is Colorado only). No writes. */
export async function locateServiceAddresses(addressIds: readonly string[], options: Options = {}):
  Promise<{ positions: Map<string, AddressPosition>; toSave: LookedUpPosition[] }> {
  const ids = [...new Set(addressIds)].slice(0, 100);
  const positions = new Map<string, AddressPosition>();
  const toSave: LookedUpPosition[] = [];
  if (!ids.length) return { positions, toSave };
  const rows = await prisma.serviceAddress.findMany({
    where: { id: { in: ids } },
    select: { id: true, line1: true, city: true, state: true, zip: true,
      geocode: { select: { latitude: true, longitude: true, addressHash: true, source: true } } },
  });
  const lookup = options.geocode ?? ((address) => geocodeAddress(address));
  for (const row of rows) {
    if (row.state.trim().toUpperCase() !== "CO") { positions.set(row.id, { status: "OUT_OF_STATE" }); continue; }
    const hash = addressHash(row);
    const kept = row.geocode;
    const keptPoint = kept ? { lat: kept.latitude, lon: kept.longitude } : null;
    if (kept && keptPoint && isGeoPoint(keptPoint) && kept.addressHash === hash) {
      positions.set(row.id, { status: "FOUND", point: keptPoint, source: kept.source });
      continue;
    }
    const found = await lookup({ line1: row.line1, city: row.city, state: row.state, zip: row.zip });
    if (found.status !== "FOUND") { positions.set(row.id, { status: found.status }); continue; }
    if (found.state && found.state.toUpperCase() !== "CO") { positions.set(row.id, { status: "OUT_OF_STATE" }); continue; }
    const point = roundGeoPoint(found.point);
    positions.set(row.id, { status: "FOUND", point, source: GEOCODE_SOURCE });
    toSave.push({ serviceAddressId: row.id, point, addressHash: hash });
  }
  return { positions, toSave };
}

/**
 * Saves looked-up positions. Call inside the caller's transaction AFTER assertActiveTeamActor. Locks each address row
 * and saves only when the street is still the one that was looked up (otherwise the position is dropped, and the
 * caller treats that address as not found).
 */
export async function saveLookedUpPositionsInTx(tx: Prisma.TransactionClient, actorId: string,
  toSave: readonly LookedUpPosition[]): Promise<Set<string>> {
  const saved = new Set<string>();
  if (!toSave.length) return saved;
  const ids = [...new Set(toSave.map((row) => row.serviceAddressId))].sort();
  await tx.$queryRaw`SELECT "id" FROM "ServiceAddress" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  const current = await tx.serviceAddress.findMany({ where: { id: { in: ids } },
    select: { id: true, line1: true, city: true, state: true, zip: true } });
  for (const row of toSave) {
    const address = current.find((candidate) => candidate.id === row.serviceAddressId);
    if (!address || addressHash(address) !== row.addressHash) continue;
    const data = { latitude: row.point.lat, longitude: row.point.lon, addressHash: row.addressHash,
      source: GEOCODE_SOURCE, geocodedAt: new Date(), geocodedByUserId: actorId };
    await tx.serviceAddressGeocode.upsert({ where: { serviceAddressId: row.serviceAddressId },
      create: { serviceAddressId: row.serviceAddressId, ...data }, update: data });
    saved.add(row.serviceAddressId);
  }
  return saved;
}
