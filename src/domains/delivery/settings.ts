import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getBusinessSettings } from "@/domains/settings";
import { readZoneSettings, roundGeoPoint, zoneSettingsProblems, type ZoneSettings } from "./zone";

/**
 * ZONE-1: read and save the owner's delivery zones (Settings › Delivery zones). Only the owner saves; a save locks the
 * settings row, re-checks the owner, compares against what the screen showed and writes one audit row. New zones apply
 * to estimates checked from then on; sent estimates and signed agreements keep their own frozen copy.
 */

export const ZONE_SETTING_FIELDS = {
  deliveryZones: true, deliveryMaxMiles: true, zoneCenter: true, zoneDistanceMethod: true,
  showDeliveryPricesOnWebsite: true,
} as const;

/** The zones for this request (from the same cached settings read the rest of the page uses). */
export const getZoneSettings = cache(async (): Promise<ZoneSettings> =>
  readZoneSettings(await getBusinessSettings()));

export async function getZoneSettingsInTx(tx: Prisma.TransactionClient): Promise<ZoneSettings> {
  const row = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: ZONE_SETTING_FIELDS });
  return readZoneSettings(row);
}

/** A short fingerprint of what the screen showed, for compare-and-set saves. */
export function zoneSettingsRevision(settings: ZoneSettings): string {
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 24);
}

export class ZoneSettingsError extends Error {}

export async function saveZoneSettings(actorId: string, next: ZoneSettings, expectedRevision: string): Promise<void> {
  const problems = zoneSettingsProblems(next);
  if (problems.length) throw new ZoneSettingsError(problems.join(" "));
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await getZoneSettingsInTx(tx);
    if (zoneSettingsRevision(before) !== expectedRevision)
      throw new ZoneSettingsError("The delivery zones were changed in another session. Reload before saving.");
    const data = {
      deliveryZones: next.zones.map((zone) => ({
        name: zone.name.trim(), outerMiles: zone.outerMiles, deliveryCents: zone.deliveryCents,
        pickupCents: zone.pickupCents, color: zone.color,
      })),
      deliveryMaxMiles: next.maxMiles,
      zoneCenter: roundGeoPoint(next.center),
      zoneDistanceMethod: next.method,
      showDeliveryPricesOnWebsite: next.showPricesOnWebsite,
    };
    await tx.businessSettings.update({ where: { id: "singleton" }, data });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "settings.delivery_zones.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: before as unknown as Prisma.InputJsonObject, newValue: data as unknown as Prisma.InputJsonObject,
      },
    });
  });
}
