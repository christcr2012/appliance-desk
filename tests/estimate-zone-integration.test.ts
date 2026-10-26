import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requestPaidDeliveryInTx } from "@/domains/orders/settled-delivery";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  checkEstimateDeliveryZones, confirmEstimateZoneMiles, frozenDeliveryCentsInTx, recordPickupArranged,
  setEstimateDeliveryChoiceByCustomer, setEstimateDeliveryChoiceByStaff,
} from "@/domains/delivery/estimate-zone";
import { approveEstimate } from "@/domains/estimates";
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
  await prisma.staffTask.deleteMany({ where: { customerId } });
  await prisma.job.deleteMany({ where: { customerId } });
  await prisma.agreementSigningPayment.deleteMany({ where: { agreementId: { in: agreements.map((a) => a.id) } } });
  await prisma.receipt.deleteMany({ where: { customerId } });
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

  it("pickup on a quote that already charged delivery withdraws that quote: the customer can never owe delivery", async () => {
    const pricedId = await estimateWith([lovelandId], "Priced delivery quote");
    await checkEstimateDeliveryZones(ownerId, pricedId, { geocode });
    // A reviewed, sent quote (its delivery charge can't be proven to be $0: no reviewed $0 fee record exists).
    await prisma.estimate.update({ where: { id: pricedId }, data: { status: "SENT", sentAt: new Date(),
      reviewedQuoteFingerprint: "a".repeat(64), reviewedOrderFingerprint: "b".repeat(64), reviewedQuoteAt: new Date() } });
    await expect(setEstimateDeliveryChoiceByStaff(ownerId, pricedId, lovelandId, "CUSTOMER_PICKUP")).rejects.toThrow(/Request changes/);
    const chosen = await setEstimateDeliveryChoiceByCustomer(pricedId, lovelandId, "CUSTOMER_PICKUP");
    expect(chosen).toMatchObject({ choice: "CUSTOMER_PICKUP", requote: { by: "CUSTOMER" } });
    const after = await prisma.estimate.findUniqueOrThrow({ where: { id: pricedId } });
    expect(after).toMatchObject({ status: "CHANGES_REQUESTED", reviewedQuoteFingerprint: null, reviewedOrderFingerprint: null });
    expect(after.changesRequestedMessage).toMatch(/pick it up/);
    await expect(approveEstimate(pricedId, { approverName: "Zone Customer", approverEmail: `zone-cust-${RUN}@example.test`,
      ipAddress: null, expectedQuoteFingerprint: "a".repeat(64) })).rejects.toThrow();
    // Re-sent with the same priced quote (no replacement review): still refused.
    await prisma.estimate.update({ where: { id: pricedId }, data: { status: "SENT",
      reviewedQuoteFingerprint: "a".repeat(64), reviewedOrderFingerprint: "b".repeat(64) } });
    await expect(approveEstimate(pricedId, { approverName: "Zone Customer", approverEmail: `zone-cust-${RUN}@example.test`,
      ipAddress: null, expectedQuoteFingerprint: "a".repeat(64) })).rejects.toThrow();
    expect((await prisma.estimate.findUniqueOrThrow({ where: { id: pricedId } })).status).not.toBe("APPROVED");
    // The guard approval uses: no reviewed quote → nothing priced (0); a reviewed quote it can't read → unknown (null).
    expect(await prisma.$transaction((tx) => frozenDeliveryCentsInTx(tx, { id: pricedId, reviewedQuoteFingerprint: null }, lovelandId))).toBe(0);
    expect(await prisma.$transaction((tx) => frozenDeliveryCentsInTx(tx, { id: pricedId, reviewedQuoteFingerprint: "a".repeat(64) }, lovelandId))).toBeNull();
  });

  it("a stale zone save is refused", async () => {
    const current = await prisma.$transaction((tx) => getZoneSettingsInTx(tx));
    await expect(saveZoneSettings(ownerId, current, "stale-revision")).rejects.toThrow(/another session/);
  });

  it("an unknown zone never guesses; staff type the miles with a reason", async () => {
    const snapshot = await checkEstimateDeliveryZones(ownerId, lostEstimateId, { geocode });
    expect(snapshot.locations[0]).toMatchObject({ zone: "UNKNOWN", priceCents: null });
    const settled = await confirmEstimateZoneMiles(ownerId, lostEstimateId, lostId, 4.2, "Measured on the county map");
    // The zones were raised by $10 in the test above: a new check uses the new prices (sent estimates kept theirs).
    expect(settled).toMatchObject({ zone: 1, priceCents: 1000, method: "STAFF_MILES" });
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

// Every way an address becomes pickup goes through becomePickupInTx: priced quotes are refused or withdrawn and any
// retained delivery request is cleared; payment settlement never books a delivery visit for a pickup address.
describe("ZONE-1 every path to pickup (real database)", () => {
  const slot = { id: randomUUID(), date: "2099-04-19", window: "AM" as const };
  const request = { slot, questions: { dryerOutlet: "UNKNOWN", stairs: false, washerHookups: "YES", crewNotes: "" } };
  const priced = { reviewedQuoteFingerprint: "c".repeat(64), reviewedOrderFingerprint: "d".repeat(64), reviewedQuoteAt: new Date() };
  const requested = { deliveryOffer: [slot], deliveryOfferVersion: 1, deliveryRequested: request, deliveryRequestedAt: new Date() };

  it("customer choice: clears the estimate's and the agreement's delivery request", async () => {
    const id = await estimateWith([lovelandId], "Path: customer choice");
    await checkEstimateDeliveryZones(ownerId, id, { geocode });
    await prisma.estimate.update({ where: { id }, data: { status: "SENT", ...requested } });
    const agreement = await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: lovelandId, sourceEstimateId: id,
      status: "DRAFT", deliveryOffer: [slot], deliveryRequested: request, deliveryRequestedAt: new Date() } });
    await setEstimateDeliveryChoiceByCustomer(id, lovelandId, "CUSTOMER_PICKUP");
    expect(await prisma.estimate.findUniqueOrThrow({ where: { id } })).toMatchObject({ deliveryRequested: null, deliveryRequestedAt: null });
    expect(await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } })).toMatchObject({ deliveryRequested: null, deliveryRequestedAt: null });
  });

  it("staff typing miles outside the area: refused on an approved priced order, pickup and cleared request on a draft", async () => {
    const approvedId = await estimateWith([lostId], "Path: miles on approved");
    await checkEstimateDeliveryZones(ownerId, approvedId, { geocode });
    await prisma.estimate.update({ where: { id: approvedId }, data: { status: "APPROVED", ...priced, ...requested } });
    await expect(confirmEstimateZoneMiles(ownerId, approvedId, lostId, 60, "Measured on the county map")).rejects.toThrow(/includes delivery/);
    const stillUnknown = readZoneSnapshot((await prisma.estimate.findUniqueOrThrow({ where: { id: approvedId } })).deliveryZoneSnapshot)!;
    expect(stillUnknown.locations[0]).toMatchObject({ zone: "UNKNOWN" });

    const draftId = await estimateWith([lostId], "Path: miles on draft");
    await checkEstimateDeliveryZones(ownerId, draftId, { geocode });
    await prisma.estimate.update({ where: { id: draftId }, data: requested });
    const settled = await confirmEstimateZoneMiles(ownerId, draftId, lostId, 60, "Measured on the county map");
    expect(settled).toMatchObject({ zone: "OUTSIDE", choice: "CUSTOMER_PICKUP" });
    expect(await prisma.estimate.findUniqueOrThrow({ where: { id: draftId } })).toMatchObject({ deliveryRequested: null });
  });

  it("outside the area on a lookup (first lookup or after a zone change): withdraws a priced quote and clears the request", async () => {
    const id = await estimateWith([goldenId], "Path: lookup outside");
    await prisma.estimate.update({ where: { id }, data: { status: "CHANGES_REQUESTED", ...priced, ...requested } });
    const snapshot = await checkEstimateDeliveryZones(ownerId, id, { geocode });
    expect(snapshot.locations[0]).toMatchObject({ zone: "OUTSIDE", choice: "CUSTOMER_PICKUP", requote: { by: "STAFF" } });
    expect(await prisma.estimate.findUniqueOrThrow({ where: { id } }))
      .toMatchObject({ reviewedQuoteFingerprint: null, reviewedOrderFingerprint: null, deliveryRequested: null });
  });

  it("after payment, settlement books no delivery for a pickup address (and still does for delivery)", async () => {
    async function paidOrder(choice: "DELIVER" | "CUSTOMER_PICKUP") {
      const id = await estimateWith([lovelandId], "Path: settlement " + choice);
      await checkEstimateDeliveryZones(ownerId, id, { geocode });
      if (choice === "CUSTOMER_PICKUP") await setEstimateDeliveryChoiceByStaff(ownerId, id, lovelandId, "CUSTOMER_PICKUP");
      // A request kept from before (e.g. written by an older code path) must still be ignored for pickup.
      await prisma.estimate.update({ where: { id }, data: { status: "CONVERTED", ...requested } });
      const agreement = await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: lovelandId, sourceEstimateId: id, status: "ACTIVE" } });
      const receipt = await prisma.receipt.create({ data: { customerId, source: "MANUAL", amountCents: 10500, method: "check",
        receivedOn: new Date(), recordedByUserId: ownerId } });
      await prisma.agreementSigningPayment.create({ data: { agreementId: agreement.id, orderFingerprint: "e".repeat(64),
        evidenceVersion: 1, setupFeeCents: 4500, setupTaxCents: 0, downPaymentCents: 6000, totalCents: 10500,
        status: "SETTLED", signedAt: new Date(), receiptId: receipt.id, settledAt: new Date() } });
      const job = await prisma.job.create({ data: { type: "DELIVERY", status: "SCHEDULED", agreementId: agreement.id,
        serviceAddressId: lovelandId, customerId } });
      return { agreement, job };
    }
    const pickup = await paidOrder("CUSTOMER_PICKUP");
    expect(await prisma.$transaction((tx) => requestPaidDeliveryInTx(tx, pickup.agreement.id))).toBeNull();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: pickup.job.id } })).requestedDeliveryAt).toBeNull();
    expect(await prisma.staffTask.count({ where: { sourceKey: "w24-confirm-delivery:" + pickup.job.id } })).toBe(0);
    const delivered = await paidOrder("DELIVER");
    expect(await prisma.$transaction((tx) => requestPaidDeliveryInTx(tx, delivered.agreement.id))).toBe(delivered.job.id);
  });

  it("an unknown zone blocks approval and conversion with a clear message (the To do can't be dropped)", async () => {
    const id = await estimateWith([lostId], "Unknown zone blocks");
    await checkEstimateDeliveryZones(ownerId, id, { geocode });
    await prisma.estimate.update({ where: { id }, data: { status: "SENT", ...priced } });
    await expect(approveEstimate(id, { approverName: "Zone Customer", approverEmail: `zone-cust-${RUN}@example.test`,
      ipAddress: null, expectedQuoteFingerprint: "c".repeat(64) })).rejects.toThrow(/Confirm the delivery zone/);
    await prisma.estimate.update({ where: { id }, data: { status: "APPROVED" } });
    await expect(convertEstimateToAgreements(ownerId, id, { mode: "single", serviceAddressId: lostId }))
      .rejects.toThrow(/Confirm the delivery zone/);
    expect(await prisma.rentalAgreement.count({ where: { sourceEstimateId: id } })).toBe(0);
    // Settled as pickup, conversion goes ahead.
    await prisma.estimate.update({ where: { id }, data: { status: "DRAFT", reviewedQuoteFingerprint: null, reviewedOrderFingerprint: null } });
    await setEstimateDeliveryChoiceByStaff(ownerId, id, lostId, "CUSTOMER_PICKUP");
    await prisma.estimate.update({ where: { id }, data: { status: "APPROVED" } });
    expect(await convertEstimateToAgreements(ownerId, id, { mode: "single", serviceAddressId: lostId })).toHaveLength(1);
  });
});
