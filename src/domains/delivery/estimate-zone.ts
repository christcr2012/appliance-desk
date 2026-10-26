import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isEstimatePastValidity } from "@/domains/estimates/validity";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { locateServiceAddresses, type AddressPosition } from "./address-zone";
import type { GeocodeResult } from "./geocode";
import { getZoneSettingsInTx } from "./settings";
import {
  buildZoneLocation, choiceAllowed, confirmZoneByMiles, readZoneSnapshot,
  type DeliveryChoice, type EstimateZoneSnapshot, type ZoneSnapshotLocation,
} from "./snapshot";

/**
 * ZONE-1 section 3: the delivery zone on an estimate. One entry per delivery address on the estimate's lines.
 *
 *  - Checking (owner/admin) runs while the estimate is a draft or has changes requested: it looks each address up
 *    (outside the transaction), then locks the estimate and stores zone, miles, method and prices from the current
 *    zones. Once the estimate is sent the zone is frozen: later zone changes never touch it.
 *  - An address the lookup can't place stays "We'll confirm your delivery price" and puts "Confirm the delivery zone
 *    for {address}" on To do; staff then type the miles with a reason (audited). This is allowed after sending, but
 *    only fills in an unknown zone; it never changes a known one.
 *  - Delivery is always optional: deliver it, or "I'll pick it up" ($0). Outside the area only pickup is offered.
 *    Staff can set the choice before the customer answers; the customer can set it on their estimate page while it is
 *    waiting for an answer. Pickup puts "Arrange pickup with {name}" on To do until staff record the arrangement.
 *
 * Audit rows hold zones, miles and prices only, never a map position.
 */

const CHECKABLE = ["DRAFT", "CHANGES_REQUESTED"] as const;
const CHOOSABLE_BY_STAFF = ["DRAFT", "CHANGES_REQUESTED", "SENT", "VIEWED", "APPROVED"] as const;
const CHOOSABLE_BY_CUSTOMER = ["SENT", "VIEWED"] as const;
const CONFIRMABLE = ["DRAFT", "CHANGES_REQUESTED", "SENT", "VIEWED", "APPROVED"] as const;
const OPEN_FOR_PICKUP = ["DRAFT", "CHANGES_REQUESTED", "SENT", "VIEWED", "APPROVED", "CONVERTED"] as const;

async function lockEstimate(tx: Prisma.TransactionClient, estimateId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Estimate" WHERE "id" = ${estimateId} FOR UPDATE`;
  if (rows.length !== 1) throw new Error("Couldn't find that estimate.");
  return tx.estimate.findUniqueOrThrow({
    where: { id: estimateId },
    select: { id: true, status: true, validUntil: true, deliveryZoneSnapshot: true, reviewedQuoteFingerprint: true,
      lineItems: { select: { serviceAddressId: true } } },
  });
}

function addressIdsOf(lines: { serviceAddressId: string | null }[]): string[] {
  return [...new Set(lines.map((line) => line.serviceAddressId).filter((id): id is string => !!id))].sort();
}

function auditLocations(snapshot: EstimateZoneSnapshot) {
  return snapshot.locations.map((row) => ({ serviceAddressId: row.serviceAddressId, zone: row.zone, miles: row.miles,
    method: row.method, priceCents: row.priceCents, pickupPriceCents: row.pickupPriceCents, choice: row.choice }));
}

/** Look up every delivery address on a draft estimate and store its zone. Returns the stored snapshot. */
export async function checkEstimateDeliveryZones(actorId: string, estimateId: string,
  options: { geocode?: (address: { line1: string; city: string; state: string; zip: string }) => Promise<GeocodeResult>;
    now?: Date } = {}): Promise<EstimateZoneSnapshot> {
  const first = await prisma.estimate.findUnique({
    where: { id: estimateId }, select: { status: true, lineItems: { select: { serviceAddressId: true } } },
  });
  if (!first) throw new Error("Couldn't find that estimate.");
  if (!(CHECKABLE as readonly string[]).includes(first.status))
    throw new Error("This estimate has been sent, so its delivery zone is frozen.");
  const positions = await locateServiceAddresses(addressIdsOf(first.lineItems), { geocode: options.geocode, actorId });
  const now = options.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const estimate = await lockEstimate(tx, estimateId);
    if (!(CHECKABLE as readonly string[]).includes(estimate.status))
      throw new Error("This estimate has been sent, so its delivery zone is frozen.");
    const settings = await getZoneSettingsInTx(tx);
    const previous = readZoneSnapshot(estimate.deliveryZoneSnapshot);
    const locations = addressIdsOf(estimate.lineItems).map((serviceAddressId) => {
      const earlier = previous?.locations.find((row) => row.serviceAddressId === serviceAddressId);
      const position: AddressPosition = positions.get(serviceAddressId) ?? { status: "UNAVAILABLE" };
      const fresh = buildZoneLocation({ serviceAddressId, position, settings, now,
        previousChoice: earlier?.choice });
      // A zone staff confirmed by hand stays until the address can be placed on the map.
      if (fresh.zone === "UNKNOWN" && earlier?.confirmed) return earlier;
      const kept = fresh.choice === "CUSTOMER_PICKUP" ? {
        ...(earlier?.pickupArranged ? { pickupArranged: earlier.pickupArranged } : {}),
        ...(earlier?.requote ? { requote: earlier.requote } : {}),
      } : {};
      return { ...fresh, ...kept, choice: choiceAllowed(fresh, fresh.choice) ? fresh.choice : "CUSTOMER_PICKUP" as const };
    });
    const snapshot: EstimateZoneSnapshot = { version: 1, locations };
    await tx.estimate.update({ where: { id: estimateId },
      data: { deliveryZoneSnapshot: snapshot as unknown as Prisma.InputJsonObject, deliveryZoneSnapshotAt: now } });
    // An address that is now outside the area (first lookup, or after a zone change) becomes pickup the one way.
    for (const location of [...snapshot.locations]) {
      const earlier = previous?.locations.find((row) => row.serviceAddressId === location.serviceAddressId);
      await becomePickupInTx(tx, { estimate, snapshot, before: earlier, after: location }, location.serviceAddressId, "STAFF");
    }
    await tx.auditLog.create({ data: { userId: actorId, action: "estimate.delivery_zone.check", entityType: "Estimate",
      entityId: estimateId, newValue: { locations: auditLocations(snapshot) } as Prisma.InputJsonObject } });
    return snapshot;
  });
}

async function updateLocation(tx: Prisma.TransactionClient, estimateId: string, serviceAddressId: string,
  allowed: readonly string[], refusal: string,
  change: (location: ZoneSnapshotLocation) => ZoneSnapshotLocation, options: { customer?: boolean } = {}) {
  const estimate = await lockEstimate(tx, estimateId);
  if (!allowed.includes(estimate.status)) throw new Error(refusal);
  if (options.customer && isEstimatePastValidity(estimate.validUntil)) throw new Error(refusal);
  const snapshot = readZoneSnapshot(estimate.deliveryZoneSnapshot);
  const index = snapshot?.locations.findIndex((row) => row.serviceAddressId === serviceAddressId) ?? -1;
  if (!snapshot || index < 0) throw new Error("Check the delivery zone for this address first.");
  if (!addressIdsOf(estimate.lineItems).includes(serviceAddressId))
    throw new Error("That address is no longer on this estimate.");
  const before = snapshot.locations[index]!;
  const after = change(before);
  snapshot.locations[index] = after;
  await tx.estimate.update({ where: { id: estimateId },
    data: { deliveryZoneSnapshot: snapshot as unknown as Prisma.InputJsonObject } });
  return { before, after, snapshot, estimate };
}

/**
 * The delivery charge already frozen into this estimate's reviewed quote for one address, in cents: 0 when there is no
 * reviewed quote (nothing is priced yet), null when it can't be worked out (treated as "may include delivery").
 * Reads the owner's latest service-fee review and, when the order is frozen for signing, its DELIVERY components.
 */
export async function frozenDeliveryCentsInTx(tx: Prisma.TransactionClient, estimate: { id: string;
  reviewedQuoteFingerprint: string | null }, serviceAddressId: string): Promise<number | null> {
  if (!estimate.reviewedQuoteFingerprint) return 0;
  const agreements = await tx.rentalAgreement.findMany({
    where: { sourceEstimateId: estimate.id, serviceAddressId },
    select: { id: true, mandatoryChargeReviewVersions: true },
  });
  if (!agreements.length) return null;
  const { readMandatoryChargeHistory } = await import("@/domains/billing/mandatory-charge-review");
  let cents = 0;
  for (const agreement of agreements) {
    try {
      const latest = readMandatoryChargeHistory(agreement.mandatoryChargeReviewVersions).at(-1);
      cents += latest?.charges.filter((charge) => charge.kind === "delivery").reduce((sum, c) => sum + c.amountCents, 0) ?? 0;
    } catch {
      return null;
    }
    try {
      const { getFrozenSigningOrderInTx } = await import("@/domains/billing/signing-frozen-verify");
      const frozen = (await getFrozenSigningOrderInTx(tx, agreement.id)).find((row) => row.agreementId === agreement.id);
      if (frozen?.schemaVersion === 2) {
        cents += frozen.v2Extension.components.filter((row) => row.category === "DELIVERY" && row.disposition === "DUE_NOW")
          .reduce((sum, row) => sum + row.amountCents, 0);
      }
    } catch {
      // Not frozen for signing yet: the fee review above is the whole priced quote.
    }
  }
  return cents;
}

/** The customer's re-quote request words (shown to staff on the estimate). */
export const PICKUP_REQUOTE_MESSAGE =
  "I'd like to pick it up instead of delivery. Please send a new quote without the delivery charge.";

function applyChoice(location: ZoneSnapshotLocation, choice: DeliveryChoice): ZoneSnapshotLocation {
  if (choice !== "DELIVER" && choice !== "CUSTOMER_PICKUP") throw new Error("Choose delivery or pickup.");
  if (!choiceAllowed(location, choice)) throw new Error("We don't deliver to this address. Only pickup is available.");
  if (choice === "CUSTOMER_PICKUP") return { ...location, choice };
  const rest = { ...location, choice };
  delete rest.pickupArranged;
  delete rest.requote;
  return rest;
}

/** Staff (owner/admin) choose delivery or pickup for one address. */
export async function setEstimateDeliveryChoiceByStaff(actorId: string, estimateId: string, serviceAddressId: string,
  choice: DeliveryChoice) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const changed = await updateLocation(tx, estimateId, serviceAddressId, CHOOSABLE_BY_STAFF,
      "This estimate is finished, so the delivery choice can't change.", (row) => applyChoice(row, choice));
    const after = await becomePickupInTx(tx, changed, serviceAddressId, "STAFF");
    await tx.auditLog.create({ data: { userId: actorId, action: "estimate.delivery_choice", entityType: "Estimate",
      entityId: estimateId, oldValue: { serviceAddressId, choice: changed.before.choice },
      newValue: { serviceAddressId, choice: after.choice, by: "STAFF", requote: !!after.requote } } });
    return after;
  });
}

/**
 * Pickup is $0, so it can never be accepted on top of a reviewed quote that already charges delivery for that address
 * (AGENTS: a reviewed quote is never rewritten silently). Choosing pickup then needs a new reviewed quote:
 *  - the customer's choice turns the estimate into "changes requested" (the reviewed quote is withdrawn, so it can't be
 *    approved or signed) and Today asks staff to "Send a new quote without delivery";
 *  - staff on a draft get the same To do; staff can't switch a sent or approved priced order to pickup (request
 *    changes first). Approval also re-checks this (index-base.ts approveEstimate).
 */
/**
 * THE one place an address becomes "I'll pick it up" (explicit customer/staff choice, staff miles outside the area,
 * outside the area on a lookup — zone setting changes reach estimates only through a lookup). Called under the
 * estimate row lock after the snapshot is written. It:
 *  1. refuses or withdraws a reviewed quote that charges delivery for this address (above);
 *  2. clears any retained delivery request for this address — the agreement's, and the estimate's once no current
 *     address is delivered — so payment settlement can't turn it into a delivery visit (settled-delivery.ts also
 *     ignores pickup addresses).
 * A no-op when the address was already pickup.
 */
export async function becomePickupInTx(tx: Prisma.TransactionClient,
  changed: { estimate: { id: string; status: string; reviewedQuoteFingerprint: string | null;
    lineItems: { serviceAddressId: string | null }[] }; snapshot: EstimateZoneSnapshot;
    before?: ZoneSnapshotLocation; after: ZoneSnapshotLocation },
  serviceAddressId: string, by: "STAFF" | "CUSTOMER"): Promise<ZoneSnapshotLocation> {
  const { before, snapshot, estimate } = changed;
  let after = changed.after;
  if (after.choice !== "CUSTOMER_PICKUP" || before?.choice === "CUSTOMER_PICKUP") return after;
  const priced = await frozenDeliveryCentsInTx(tx, estimate, serviceAddressId);
  const data: Prisma.EstimateUpdateInput = {};
  if (priced !== 0) {
    if (by === "STAFF" && !(CHECKABLE as readonly string[]).includes(estimate.status))
      throw new Error("This quote includes delivery. Request changes and send a new quote without delivery before switching to pickup.");
    after = { ...after, requote: { at: new Date().toISOString(), by } };
    Object.assign(data, { reviewedQuoteFingerprint: null, reviewedOrderFingerprint: null, reviewedQuoteAt: null,
      ...(by === "CUSTOMER" ? { status: "CHANGES_REQUESTED" as const, respondedAt: new Date(),
        changesRequestedMessage: PICKUP_REQUOTE_MESSAGE } : {}) });
  }
  snapshot.locations = snapshot.locations.map((row) => row.serviceAddressId === serviceAddressId ? after : row);
  const current = addressIdsOf(estimate.lineItems);
  const anyDelivered = snapshot.locations.some((row) => current.includes(row.serviceAddressId) && row.choice === "DELIVER");
  if (!anyDelivered) Object.assign(data, { deliveryRequested: Prisma.DbNull, deliveryRequestedAt: null });
  await tx.estimate.update({ where: { id: estimate.id }, data: {
    ...data, deliveryZoneSnapshot: snapshot as unknown as Prisma.InputJsonObject } });
  await tx.rentalAgreement.updateMany({ where: { sourceEstimateId: estimate.id, serviceAddressId },
    data: { deliveryRequested: Prisma.DbNull, deliveryRequestedAt: null } });
  return after;
}

/**
 * The customer chooses on their own estimate page (the private estimate link). Only while the estimate is waiting for
 * their answer, only for an address on this estimate, and the price always comes from the frozen zone.
 */
export async function setEstimateDeliveryChoiceByCustomer(estimateId: string, serviceAddressId: string,
  choice: DeliveryChoice) {
  return prisma.$transaction(async (tx) => {
    const changed = await updateLocation(tx, estimateId, serviceAddressId, CHOOSABLE_BY_CUSTOMER,
      "This estimate is no longer waiting for your answer.", (row) => applyChoice(row, choice), { customer: true });
    const after = await becomePickupInTx(tx, changed, serviceAddressId, "CUSTOMER");
    await tx.auditLog.create({ data: { userId: null, action: "estimate.delivery_choice", entityType: "Estimate",
      entityId: estimateId, oldValue: { serviceAddressId, choice: changed.before.choice },
      newValue: { serviceAddressId, choice: after.choice, by: "CUSTOMER", requote: !!after.requote } } });
    return after;
  });
}

/** Staff settle an unknown zone by typing the miles, with a reason. */
export async function confirmEstimateZoneMiles(actorId: string, estimateId: string, serviceAddressId: string,
  miles: number, reason: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const settings = await getZoneSettingsInTx(tx);
    const changed = await updateLocation(tx, estimateId, serviceAddressId, CONFIRMABLE,
      "This estimate is finished, so its delivery zone can't change.", (row) => {
        const settled = confirmZoneByMiles(row, { miles, reason, userId: actorId, settings, now });
        return { ...settled, choice: choiceAllowed(settled, settled.choice) ? settled.choice : "CUSTOMER_PICKUP" };
      });
    // Outside the area → pickup only: the same reconciliation as an explicit choice (refused on a sent or approved
    // priced order, which rolls back the confirmation too).
    const after = await becomePickupInTx(tx, changed, serviceAddressId, "STAFF");
    await tx.auditLog.create({ data: { userId: actorId, action: "estimate.delivery_zone.confirm", entityType: "Estimate",
      entityId: estimateId, newValue: { serviceAddressId, zone: after.zone, miles: after.miles,
        priceCents: after.priceCents, reason: after.confirmed?.reason ?? null } } });
    return after;
  });
}

/** Staff record when and where a customer pickup was arranged (clears the "Arrange pickup" To do). */
export async function recordPickupArranged(actorId: string, estimateId: string, serviceAddressId: string, note: string,
  now = new Date()) {
  const clean = note.replace(/\s+/g, " ").trim();
  if (clean.length < 5 || clean.length > 300) throw new Error("Write the date, time and place (5 to 300 characters).");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const { after } = await updateLocation(tx, estimateId, serviceAddressId, OPEN_FOR_PICKUP,
      "This estimate is closed.", (row) => {
        if (row.choice !== "CUSTOMER_PICKUP") throw new Error("This address is set to delivery, not pickup.");
        return { ...row, pickupArranged: { userId: actorId, note: clean, at: now.toISOString() } };
      });
    await tx.auditLog.create({ data: { userId: actorId, action: "estimate.pickup_arranged", entityType: "Estimate",
      entityId: estimateId, newValue: { serviceAddressId, note: clean } } });
    return after;
  });
}

/**
 * After conversion: copy each address's frozen zone onto its agreement (only when the agreement has none yet, so a
 * retry changes nothing).
 */
export async function copyEstimateZoneToAgreements(estimateId: string, agreementIds: readonly string[]) {
  if (!agreementIds.length) return 0;
  return prisma.$transaction(async (tx) => {
    const estimate = await tx.estimate.findUnique({ where: { id: estimateId }, select: { deliveryZoneSnapshot: true } });
    const snapshot = readZoneSnapshot(estimate?.deliveryZoneSnapshot);
    if (!snapshot) return 0;
    const ids = [...agreementIds].sort();
    await tx.$queryRaw`SELECT "id" FROM "RentalAgreement" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    const agreements = await tx.rentalAgreement.findMany({
      where: { id: { in: ids }, sourceEstimateId: estimateId },
      select: { id: true, serviceAddressId: true, deliveryZoneSnapshot: true },
    });
    let copied = 0;
    for (const agreement of agreements) {
      if (agreement.deliveryZoneSnapshot !== null) continue;
      const location = snapshot.locations.find((row) => row.serviceAddressId === agreement.serviceAddressId);
      if (!location) continue;
      await tx.rentalAgreement.update({ where: { id: agreement.id },
        data: { deliveryZoneSnapshot: { ...location, estimateId } as unknown as Prisma.InputJsonObject } });
      copied++;
    }
    return copied;
  });
}
