// ZONE-1: one rule decides each address's delivery charge everywhere (quote, approval, signing): $0 for pickup, an
// owner-recorded driving-route exception's frozen price, otherwise the frozen straight-line zone price. The address
// here is 12 straight-line miles from central Greeley (Local, free) but 20 road miles (Nearby band).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSyntheticW22V2Order } from "./helpers/w22-v2-order";
import { getPreparedEstimateQuote } from "@/domains/estimates/preapproval-quote";
import { sendEstimate, approveEstimate, convertEstimateToAgreements } from "@/domains/estimates";
import { recordSigningBusinessReview } from "@/domains/billing/signing-business-review";
import { sendForSignature, signAgreement } from "@/domains/agreements";
import { customerDeliveryChargesForEstimate, recordDeliveryRouteEvidence, setVerifiedDrivingOrigin } from "@/domains/orders/route-evidence";
import { currentLocations } from "@/domains/delivery/snapshot";
import { setEstimateDeliveryChoiceByStaff } from "@/domains/delivery/estimate-zone";
import { isAgreementPickupInTx } from "@/domains/delivery/pickup-guard";
import { buildZoneLocation } from "@/domains/delivery/snapshot";
import { startingZoneSettings, STARTING_CENTER } from "@/domains/delivery/zone";
import { renderToStaticMarkup } from "react-dom/server";
import { EstimateDeliveryChoice } from "@/app/estimate/[id]/delivery-choice";

let owner = "";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }) }));
vi.mock("@/app/estimate/[id]/zone-actions", () => ({ chooseDeliveryAction: async () => undefined }));

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);
const ORIGIN = "1000 10th Street, Greeley, CO 80631";
const settings = startingZoneSettings();
const NEARBY_CENTS = settings.zones[1]!.deliveryCents;
const approver = { approverName: "Synthetic Customer", approverEmail: "zone-route@test.invalid", ipAddress: null };

type Fixture = Awaited<ReturnType<typeof createSyntheticW22V2Order>>;
/** What the customer's estimate page shows for each address (the same charge approval and signing require). */
async function shownCharges(fixture: Fixture) {
  const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: fixture.estimateId },
    select: { status: true, deliveryZoneSnapshot: true, lineItems: { select: { serviceAddressId: true } } } });
  const ids = estimate.lineItems.map((line) => line.serviceAddressId);
  const charges = await customerDeliveryChargesForEstimate(fixture.estimateId, currentLocations(estimate.deliveryZoneSnapshot, ids));
  const html = renderToStaticMarkup(EstimateDeliveryChoice({ estimateId: fixture.estimateId, status: "SENT",
    snapshot: estimate.deliveryZoneSnapshot, addresses: [...new Set(ids)].flatMap((id) => id ? [{ id, label: "Synthetic address" }] : []), charges }));
  return { charges, html };
}
/** Both addresses 12 straight-line miles north of the zone center: the Local (free) zone. */
async function freezeLocalZones(fixture: Fixture) {
  const agreements = await prisma.rentalAgreement.findMany({ where: { id: { in: fixture.ids } }, select: { serviceAddressId: true } });
  const now = new Date();
  const locations = agreements.map((row) => buildZoneLocation({ serviceAddressId: row.serviceAddressId, settings, now,
    position: { status: "FOUND", point: { lat: STARTING_CENTER.lat + 12 / 69, lon: STARTING_CENTER.lon } } }));
  expect(locations.map((row) => [row.zone, row.priceCents])).toEqual([[1, 0], [1, 0]]);
  await prisma.estimate.update({ where: { id: fixture.estimateId }, data: {
    deliveryZoneSnapshot: { version: 1, locations } as unknown as Prisma.InputJsonObject, deliveryZoneSnapshotAt: now } });
}
function review(fixture: Fixture) {
  return { agreementId: fixture.ids[0], expectedOrderFingerprint: fixture.orderFingerprint, decision: "APPROVED" as const,
    effectiveFromKey: fixture.day, confirmedOnKey: fixture.day, taxAdviserReference: "Synthetic CPA advice for isolated test only",
    legalAdviserReference: "Synthetic attorney advice for isolated test only", termsReference: "Synthetic complete signing and refund terms",
    reason: "Synthetic owner attestation; no actual professional approval", acknowledged: true };
}
async function approveConvertAndSign(fixture: Fixture) {
  const quote = await getPreparedEstimateQuote(fixture.estimateId);
  expect(quote.reasons).toEqual([]);
  expect(quote.status).toBe("READY");
  await sendEstimate(fixture.owner, fixture.estimateId);
  await approveEstimate(fixture.estimateId, { expectedQuoteFingerprint: quote.quoteFingerprint!, ...approver });
  await convertEstimateToAgreements(fixture.owner, fixture.estimateId, { mode: "per-property" });
  for (const id of fixture.ids) {
    const signature = await sendForSignature(fixture.owner, id);
    await signAgreement(signature.id, { signerName: "Synthetic Customer", signerEmail: "zone-route@test.invalid", ipAddress: null });
    expect((await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signature.id } })).signedAt).not.toBeNull();
  }
  return quote;
}

describe.skipIf(!enabled)("ZONE-1 12 straight-line miles / 20 road miles, end to end through approval and signing", () => {
  let previousOrigin: { drivingOriginAddress: string; drivingOriginVerifiedAt: Date | null; drivingOriginSourceReference: string | null } | null = null;
  const cleanups: Array<() => Promise<void>> = [];
  beforeAll(async () => {
    previousOrigin = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" },
      select: { drivingOriginAddress: true, drivingOriginVerifiedAt: true, drivingOriginSourceReference: true } });
    // Before any order is priced: changing a business setting makes earlier frozen reviews stale (by design).
    const staffOrOwner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    await setVerifiedDrivingOrigin(staffOrOwner.id, ORIGIN, "Synthetic verified origin for an isolated test");
  });
  afterAll(async () => {
    // Newest first: each fixture restores the shared settings it found, so the oldest restores the original last.
    for (const cleanup of cleanups.reverse()) await cleanup();
    if (previousOrigin) await prisma.businessSettings.update({ where: { id: "singleton" }, data: previousOrigin });
  });

  it("without a recorded exception the Local zone price ($0) is the only accepted delivery charge", async () => {
    // A quote that still charges the road-mile price is refused.
    const charged = await createSyntheticW22V2Order();
    cleanups.push(charged.cleanup);
    owner = charged.owner;
    await freezeLocalZones(charged);
    await recordSigningBusinessReview(charged.owner, review(charged));
    const refused = await getPreparedEstimateQuote(charged.estimateId);
    expect(refused.status).not.toBe("READY");
    expect(refused.reasons.join(" ")).toMatch(/doesn't match this address's delivery zone/);
    // Approval re-runs the same check under the estimate lock, so it can't pass either.
    await prisma.estimate.update({ where: { id: charged.estimateId }, data: { status: "SENT", sentAt: new Date() } });
    await expect(approveEstimate(charged.estimateId, { expectedQuoteFingerprint: "0".repeat(64), ...approver }))
      .rejects.toThrow(/changed or was never reviewed/);

    // Priced at the zone ($0): approval and signing both pass.
    const free = await createSyntheticW22V2Order({ firstDeliveryCents: 0 });
    cleanups.push(free.cleanup);
    await freezeLocalZones(free);
    const noException = await shownCharges(free);
    expect(Object.values(noException.charges).every((row) => row.deliverCents === 0 && !row.routeException)).toBe(true);
    expect(noException.html).not.toContain("driving route");
    await recordSigningBusinessReview(free.owner, review(free));
    await approveConvertAndSign(free);
    const signed = await prisma.rentalAgreement.findMany({ where: { id: { in: free.ids } }, select: { deliveryZoneSnapshot: true } });
    expect(signed.every((row) => (row.deliveryZoneSnapshot as { priceCents?: number } | null)?.priceCents === 0)).toBe(true);
  });

  it("signing a prepared agreement before conversion is checked against the source estimate's zone", async () => {
    // Frozen order: $0 delivery. The estimate's zone for the first address is Nearby (paid) — signing must refuse.
    const fixture = await createSyntheticW22V2Order({ firstDeliveryCents: 0 });
    cleanups.push(fixture.cleanup);
    owner = fixture.owner;
    await freezeLocalZones(fixture);
    await recordSigningBusinessReview(fixture.owner, review(fixture));
    const first = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.ids[0] },
      select: { serviceAddressId: true, deliveryZoneSnapshot: true } });
    expect(first.deliveryZoneSnapshot).toBeNull(); // not converted: no frozen copy on the agreement yet
    const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: fixture.estimateId }, select: { deliveryZoneSnapshot: true } });
    const snapshot = estimate.deliveryZoneSnapshot as unknown as { version: 1; locations: Array<{ serviceAddressId: string }> };
    const nearby = buildZoneLocation({ serviceAddressId: first.serviceAddressId, settings, now: new Date(),
      position: { status: "FOUND", point: { lat: STARTING_CENTER.lat + 20 / 69, lon: STARTING_CENTER.lon } } });
    expect(nearby.priceCents).toBe(NEARBY_CENTS);
    await prisma.estimate.update({ where: { id: fixture.estimateId }, data: { deliveryZoneSnapshot: {
      version: 1, locations: snapshot.locations.map((row) => row.serviceAddressId === first.serviceAddressId ? nearby : row),
    } as unknown as Prisma.InputJsonObject } });
    const signature = await sendForSignature(fixture.owner, fixture.ids[0]);
    await expect(signAgreement(signature.id, { signerName: "Synthetic Customer", signerEmail: "zone-route@test.invalid", ipAddress: null }))
      .rejects.toThrow(/doesn't match its delivery zone/);
    expect((await prisma.signatureRecord.findUniqueOrThrow({ where: { id: signature.id } })).signedAt).toBeNull();
  });

  it("signing before conversion freezes the zone onto the agreement; later estimate changes can't change it (Codex finding on PR #604)", async () => {
    const fixture = await createSyntheticW22V2Order({ firstDeliveryCents: 0 });
    cleanups.push(fixture.cleanup);
    owner = fixture.owner;
    await freezeLocalZones(fixture);
    await recordSigningBusinessReview(fixture.owner, review(fixture));
    const first = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.ids[0] }, select: { serviceAddressId: true } });
    const signature = await sendForSignature(fixture.owner, fixture.ids[0]);
    await signAgreement(signature.id, { signerName: "Synthetic Customer", signerEmail: "zone-route@test.invalid", ipAddress: null });
    const signed = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.ids[0] } });
    expect(signed.status).toBe("ACTIVE");
    expect(signed.deliveryZoneSnapshot).toMatchObject({ serviceAddressId: first.serviceAddressId, zone: 1, priceCents: 0,
      choice: "DELIVER", estimateId: fixture.estimateId });
    expect(await prisma.job.count({ where: { agreementId: signed.id, type: "DELIVERY", customerPickupHandoff: false } })).toBe(1);
    // The estimate is still a draft: changing this address to pickup is refused, and the agreement is unchanged.
    await expect(setEstimateDeliveryChoiceByStaff(fixture.owner, fixture.estimateId, first.serviceAddressId, "CUSTOMER_PICKUP"))
      .rejects.toThrow(/already signed/);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: signed.id } })).deliveryZoneSnapshot)
      .toEqual(signed.deliveryZoneSnapshot);
    // The other address's agreement isn't signed, so its choice can still change.
    const second = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.ids[1] }, select: { serviceAddressId: true } });
    await expect(setEstimateDeliveryChoiceByStaff(fixture.owner, fixture.estimateId, second.serviceAddressId, "CUSTOMER_PICKUP"))
      .resolves.toMatchObject({ choice: "CUSTOMER_PICKUP" });
    // Even an estimate copy changed some other way never makes the signed agreement pickup.
    const estimate = await prisma.estimate.findUniqueOrThrow({ where: { id: fixture.estimateId }, select: { deliveryZoneSnapshot: true } });
    const snapshot = estimate.deliveryZoneSnapshot as unknown as { version: 1; locations: Array<Record<string, unknown>> };
    await prisma.estimate.update({ where: { id: fixture.estimateId }, data: { deliveryZoneSnapshot: { version: 1,
      locations: snapshot.locations.map((row) => ({ ...row, choice: "CUSTOMER_PICKUP" })) } as unknown as Prisma.InputJsonObject } });
    expect(await prisma.$transaction((tx) => isAgreementPickupInTx(tx, signed.id))).toBe(false);
  });

  it("with an owner-recorded driving-route exception its frozen road price is the accepted charge, through approval and signing", async () => {
    const fixture = await createSyntheticW22V2Order();
    cleanups.push(fixture.cleanup);
    owner = fixture.owner;
    await freezeLocalZones(fixture);
    await recordSigningBusinessReview(fixture.owner, review(fixture));
    expect((await getPreparedEstimateQuote(fixture.estimateId)).status).not.toBe("READY");

    const fee = await recordDeliveryRouteEvidence(fixture.owner, { agreementId: fixture.ids[0] }, {
      miles: 20, source: "OWNER_MANUAL_DRIVING_ROUTE", sourceReference: "Synthetic owner-recorded road route",
      measuredAt: new Date().toISOString(), origin: ORIGIN });
    expect(fee.amountCents).toBe(NEARBY_CENTS);
    // The customer page shows the exception's price for that address, never "free delivery" above a $75 quote.
    const firstAddress = (await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: fixture.ids[0] }, select: { serviceAddressId: true } })).serviceAddressId;
    const shown = await shownCharges(fixture);
    expect(shown.charges[firstAddress]).toEqual({ deliverCents: NEARBY_CENTS, routeException: true });
    expect(shown.html).toContain("but because of the driving route to your address, delivery is $75");
    // Only the first address has the exception: it shows $75, the other address keeps its zone's free delivery.
    const items = shown.html.split("<li>").slice(1);
    const exceptionItem = items.find((item) => item.includes(`value="${firstAddress}"`));
    expect(exceptionItem).toContain("You chose delivery ($75)");
    expect(exceptionItem).not.toContain("(Free)");
    expect(items.filter((item) => item !== exceptionItem).every((item) => item.includes("You chose delivery (Free)"))).toBe(true);
    expect(NEARBY_CENTS).toBe(7500); // the fixture's reviewed delivery charge for the first address
    // An estimate-level exception can't say which of two addresses it is for.
    await expect(recordDeliveryRouteEvidence(fixture.owner, { estimateId: fixture.estimateId }, {
      miles: 20, source: "OWNER_MANUAL_DRIVING_ROUTE", sourceReference: "Synthetic owner-recorded road route",
      measuredAt: new Date().toISOString(), origin: ORIGIN })).rejects.toThrow(/more than one address/);

    const quote = await approveConvertAndSign(fixture);
    expect(quote.totals?.dueAtSigningCents).toBe(45606);
  });
});
