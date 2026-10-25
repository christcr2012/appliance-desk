import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  checkEstimateDeliveryZones, confirmEstimateZoneMiles, recordPickupArranged, setEstimateDeliveryChoiceByCustomer,
  setEstimateDeliveryChoiceByStaff,
} from "@/domains/delivery/estimate-zone";
import { saveZoneSettings, zoneSettingsRevision, getZoneSettingsInTx } from "@/domains/delivery/settings";
import { readZoneSnapshot } from "@/domains/delivery/snapshot";
import { convertEstimateToAgreements, getEstimateForApproval } from "@/domains/estimates";
import type { GeocodeResult } from "@/domains/delivery/geocode";

// ZONE-1 on throwaway Postgres: zone and price from the address, pickup choice, outside-area refusal, frozen snapshot,
// staff-confirmed unknown zones, copy to the agreement, and no map position reaching a customer read.
const RUN = Math.random().toString(36).slice(2, 10);
const POINTS: Record<string, GeocodeResult> = {
  "100 Loveland Ave": { status: "FOUND", point: { lat: 40.398, lon: -105.075 }, state: "CO", zip: "80537" },
  "200 Golden Way": { status: "FOUND", point: { lat: 39.755, lon: -105.221 }, state: "CO", zip: "80401" },
  "300 Lost Road": { status: "UNAVAILABLE" },
};
const geocode = vi.fn(async (address: { line1: string }) => POINTS[address.line1] ?? { status: "NO_MATCH" as const });

let ownerId: string, customerUserId: string, customerId: string, otherCustomerId: string;
let lovelandId: string, goldenId: string, lostId: string, otherAddressId: string;
let estimateId: string, lostEstimateId: string;
let savedZones: Prisma.JsonValue;

async function estimateWith(addressIds: string[], title: string) {
  const estimate = await prisma.estimate.create({ data: { customerId, title, createdByUserId: ownerId } });
  for (const serviceAddressId of addressIds) {
    await prisma.estimateLineItem.create({ data: { estimateId: estimate.id, serviceAddressId, description: "Washer", monthlyPriceCents: 3500 } });
  }
  return estimate.id;
}

beforeAll(async () => {
  savedZones = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { deliveryZones: true } })).deliveryZones;
  ownerId = (await prisma.user.create({ data: { email: `zone-owner-${RUN}@example.test`, name: "Zone Owner", role: "OWNER", emailVerified: true } })).id;
  customerUserId = (await prisma.user.create({ data: { email: `zone-cust-${RUN}@example.test`, name: "Zone Customer", role: "CUSTOMER", emailVerified: true } })).id;
  customerId = (await prisma.customer.create({ data: { userId: customerUserId, referralCode: `ZONE${RUN}`.toUpperCase() } })).id;
  const otherUser = await prisma.user.create({ data: { email: `zone-other-${RUN}@example.test`, name: "Other", role: "CUSTOMER", emailVerified: true } });
  otherCustomerId = (await prisma.customer.create({ data: { userId: otherUser.id, referralCode: `ZONO${RUN}`.toUpperCase() } })).id;
  lovelandId = (await prisma.serviceAddress.create({ data: { customerId, line1: "100 Loveland Ave", city: "Loveland", zip: "80537" } })).id;
  goldenId = (await prisma.serviceAddress.create({ data: { customerId, line1: "200 Golden Way", city: "Golden", zip: "80401" } })).id;
  lostId = (await prisma.serviceAddress.create({ data: { customerId, line1: "300 Lost Road", city: "Greeley", zip: "80631" } })).id;
  otherAddressId = (await prisma.serviceAddress.create({ data: { customerId: otherCustomerId, line1: "100 Loveland Ave", city: "Loveland", zip: "80537" } })).id;
  estimateId = await estimateWith([lovelandId, goldenId], "Zone test");
  lostEstimateId = await estimateWith([lostId], "Unknown zone test");
});

afterAll(async () => {
  await prisma.businessSettings.update({ where: { id: "singleton" }, data: { deliveryZones: savedZones as Prisma.InputJsonValue } });
  const agreements = await prisma.rentalAgreement.findMany({ where: { customerId }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: { in: [estimateId, lostEstimateId, ...agreements.map((a) => a.id)] } }] } });
  await prisma.rentalAgreement.deleteMany({ where: { customerId } });
  await prisma.estimate.deleteMany({ where: { customerId } });
  await prisma.serviceAddress.deleteMany({ where: { customerId: { in: [customerId, otherCustomerId] } } });
  await prisma.customer.deleteMany({ where: { id: { in: [customerId, otherCustomerId] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${RUN}@example.test` } } });
});

describe("ZONE-1 estimate zones on a real database", () => {
  it("finds the zone and price from the address and keeps the map position on its own row", async () => {
    const snapshot = await checkEstimateDeliveryZones(ownerId, estimateId, { geocode });
    const loveland = snapshot.locations.find((row) => row.serviceAddressId === lovelandId)!;
    expect(loveland).toMatchObject({ zone: 2, name: "Nearby", method: "STRAIGHT_LINE", priceCents: 7500, pickupPriceCents: 7500, choice: "DELIVER" });
    expect(loveland.miles).toBeGreaterThan(19);
    expect(await prisma.serviceAddressGeocode.count({ where: { serviceAddressId: lovelandId } })).toBe(1);
    geocode.mockClear();
    await checkEstimateDeliveryZones(ownerId, estimateId, { geocode });
    expect(geocode).not.toHaveBeenCalled(); // looked up once; the street didn't change
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: estimateId, action: "estimate.delivery_zone.check" } });
    expect(JSON.stringify(audit.newValue)).not.toMatch(/40\.39|105\.07|latitude|center/);
  });

  it("offers only pickup beyond 50 miles", async () => {
    const stored = readZoneSnapshot((await prisma.estimate.findUniqueOrThrow({ where: { id: estimateId } })).deliveryZoneSnapshot)!;
    expect(stored.locations.find((row) => row.serviceAddressId === goldenId)).toMatchObject({ zone: "OUTSIDE", choice: "CUSTOMER_PICKUP", priceCents: null });
    await expect(setEstimateDeliveryChoiceByStaff(ownerId, estimateId, goldenId, "DELIVER")).rejects.toThrow(/Only pickup/);
  });

  it("pickup by arrangement costs $0 and is recorded", async () => {
    const pickup = await setEstimateDeliveryChoiceByStaff(ownerId, estimateId, lovelandId, "CUSTOMER_PICKUP");
    expect(pickup.choice).toBe("CUSTOMER_PICKUP");
    const arranged = await recordPickupArranged(ownerId, estimateId, lovelandId, "Sat Nov 1, 10 am at the shop");
    expect(arranged.pickupArranged?.note).toBe("Sat Nov 1, 10 am at the shop");
    const back = await setEstimateDeliveryChoiceByStaff(ownerId, estimateId, lovelandId, "DELIVER");
    expect(back).toMatchObject({ choice: "DELIVER", priceCents: 7500 });
    expect(back.pickupArranged).toBeUndefined();
  });

  it("freezes the zone once sent: later zone changes don't touch it; the customer may still choose", async () => {
    await prisma.estimate.update({ where: { id: estimateId }, data: { status: "SENT", sentAt: new Date() } });
    const current = await prisma.$transaction((tx) => getZoneSettingsInTx(tx));
    const pricier = { ...current, zones: current.zones.map((zone) => ({ ...zone, deliveryCents: zone.deliveryCents + 1000 })) };
    await saveZoneSettings(ownerId, pricier, zoneSettingsRevision(current));
    await expect(checkEstimateDeliveryZones(ownerId, estimateId, { geocode })).rejects.toThrow(/frozen/);
    const chosen = await setEstimateDeliveryChoiceByCustomer(estimateId, lovelandId, "CUSTOMER_PICKUP");
    expect(chosen).toMatchObject({ choice: "CUSTOMER_PICKUP", priceCents: 7500 });
    await expect(setEstimateDeliveryChoiceByCustomer(estimateId, otherAddressId, "DELIVER")).rejects.toThrow(/Check the delivery zone/);
    await prisma.estimate.update({ where: { id: estimateId }, data: { status: "APPROVED" } });
    await expect(setEstimateDeliveryChoiceByCustomer(estimateId, lovelandId, "DELIVER")).rejects.toThrow(/no longer waiting/);
  });

  it("a stale zone save is refused", async () => {
    const current = await prisma.$transaction((tx) => getZoneSettingsInTx(tx));
    await expect(saveZoneSettings(ownerId, current, "stale-revision")).rejects.toThrow(/another session/);
  });

  it("an unknown zone never guesses; staff type the miles with a reason", async () => {
    const snapshot = await checkEstimateDeliveryZones(ownerId, lostEstimateId, { geocode });
    expect(snapshot.locations[0]).toMatchObject({ zone: "UNKNOWN", priceCents: null });
    const settled = await confirmEstimateZoneMiles(ownerId, lostEstimateId, lostId, 4.2, "Measured on the county map");
    expect(settled).toMatchObject({ zone: 1, priceCents: 0, method: "STAFF_MILES" });
    await expect(confirmEstimateZoneMiles(ownerId, lostEstimateId, lostId, 40, "Changed my mind")).rejects.toThrow(/already/);
  });

  it("copies each address's frozen zone to its agreement on conversion", async () => {
    const ids = await convertEstimateToAgreements(ownerId, estimateId, { mode: "single", serviceAddressId: lovelandId });
    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(agreement.deliveryZoneSnapshot).toMatchObject({ zone: 2, priceCents: 7500, choice: "CUSTOMER_PICKUP", estimateId });
  });

  it("never sends a map position to a customer: the estimate page read has no coordinates", async () => {
    const read = await getEstimateForApproval(estimateId);
    const text = JSON.stringify(read);
    expect(text).not.toMatch(/latitude|longitude|addressHash/);
    // The other customer's identical street was never looked up or linked to this customer.
    expect(await prisma.serviceAddressGeocode.count({ where: { serviceAddressId: otherAddressId } })).toBe(0);
  });
});
