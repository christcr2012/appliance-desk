// ZONE-1 (Codex finding on PR #604) on throwaway Postgres: "I'll pick it up" gets a customer pickup hand-over job at
// signing; completing it runs the ordinary delivered path (first delivered date, continuity, Rented, custody, the
// recurring-billing hand-off) but records no truck trip: no driver-route stop, no retail delivery fee, no delivery count.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/domains/billing/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domains/billing/checkout")>()),
  startRecurringBillingForAgreement: m.start,
}));
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "handoff-owner", role: "OWNER" } }),
}));

import { prisma } from "@/lib/prisma";
import { completeJob, createJob, getDriverJobsForToday } from "@/domains/jobs";
import { ensureSignedDeliveryDraftInTx } from "@/domains/agreements/signed-delivery";
import { listSignedDeliveryAttention } from "@/domains/exceptions/signed-delivery-attention";
import { businessDateKey, businessDateFromKey } from "@/lib/business-date";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("ZONE-1 customer pickup hand-over", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `ho-owner-${tag}`;
  const userId = `ho-user-${tag}`;
  const customerId = `ho-customer-${tag}`;
  const addressId = `ho-address-${tag}`;
  const typeId = `ho-type-${tag}`;
  const applianceIds: string[] = [];
  const agreementIds: string[] = [];
  let taxCleanup: (() => Promise<void>) | null = null;
  let jurisdictionId = "";

  const zone = (choice: "DELIVER" | "CUSTOMER_PICKUP") => ({ serviceAddressId: addressId, zone: 1, name: "Local", miles: 4,
    method: "STRAIGHT_LINE", center: { lat: 40.4233, lon: -104.7091 }, priceCents: 0, pickupPriceCents: 0, choice,
    checkedAt: new Date().toISOString() }) as unknown as Prisma.InputJsonObject;

  /** A signed (ACTIVE) rental with one reserved washer set aside for it, and its signing job. */
  async function signedRental(choice: "DELIVER" | "CUSTOMER_PICKUP") {
    const agreementId = `ho-agreement-${agreementIds.length}-${tag}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({ data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE",
      startDate: new Date(), deliveryZoneSnapshot: zone(choice),
      lines: { create: { label: "Washer", monthlyPriceCents: 3500, listPriceCents: 3500 } } } });
    await prisma.signatureRecord.create({ data: { agreementId, provider: "test", signerName: "HO Customer", signerEmail: `${tag}-c@example.test`,
      signedAt: new Date() } });
    const lineId = (await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } })).id;
    const applianceId = `ho-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(applianceId);
    await prisma.appliance.create({ data: { id: applianceId, assetNumber: `HO${applianceIds.length}-${tag.slice(0, 8)}`,
      applianceTypeId: typeId, status: "RESERVED" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId } });
    const jobId = await prisma.$transaction((tx) => ensureSignedDeliveryDraftInTx(tx,
      { id: agreementId, customerId, serviceAddressId: addressId, renewedFromAgreementId: null }));
    return { agreementId, applianceId, jobId: jobId! };
  }
  const finish = (jobId: string, applianceId: string) => completeJob(ownerId, {
    jobId, expectedVersion: 1, completionKey: `ho-key-${randomUUID()}`, performedOn: businessDateFromKey(businessDateKey(new Date())),
    completionNotes: null, results: [{ applianceId, result: "DELIVERED" }],
  });

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${tag}-o@example.test`, name: "HO Owner", role: "OWNER", emailVerified: true },
      { id: userId, email: `${tag}-c@example.test`, name: "HO Customer", role: "CUSTOMER", emailVerified: true },
    ] });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `H${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Pickup St", city: "Greeley", zip: "80631" } });
    // A verified city location: a real delivery here counts toward the city's delivery license rule.
    const tax = await seedTaxReadyContext(addressId);
    taxCleanup = tax.cleanup;
    jurisdictionId = tax.jurisdictionId;
    await prisma.applianceType.create({ data: { id: typeId, name: `HO Washer ${tag.slice(0, 6)}`, slug: `ho-${tag}` } });
  });
  beforeEach(() => { m.start.mockReset().mockResolvedValue({ state: "DONE" }); });
  afterAll(async () => {
    const jobs = (await prisma.job.findMany({ where: { customerId }, select: { id: true } })).map((row) => row.id);
    await prisma.staffTask.deleteMany({ where: { OR: [{ jobId: { in: jobs } }, { customerId }] } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.jurisdictionDeliveryCount.deleteMany({ where: { orderId: { in: agreementIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: { in: [...jobs, ...applianceIds, ...agreementIds] } }] } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    if (taxCleanup) await taxCleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("signing a pickup rental creates its hand-over with the right words; an ordinary delivery visit is still refused", async () => {
    const rental = await signedRental("CUSTOMER_PICKUP");
    expect(await prisma.job.findMany({ where: { agreementId: rental.agreementId } })).toEqual([expect.objectContaining({
      id: rental.jobId, type: "DELIVERY", customerPickupHandoff: true, status: "SCHEDULED", scheduledAt: null })]);
    const todo = (await listSignedDeliveryAttention(50, { customerId })).rows.find((row) => row.href.endsWith(rental.jobId));
    expect(todo).toMatchObject({ title: `Customer pickup: hand over HO Washer ${tag.slice(0, 6)} to HO Customer`,
      primaryAction: { label: "Open hand-over" } });
    expect(JSON.stringify(todo)).not.toMatch(/Schedule delivery/);
    await expect(createJob(ownerId, { type: "DELIVERY", customerId, serviceAddressId: addressId, agreementId: rental.agreementId }))
      .rejects.toThrow(/customer pickup/);
    // A follow-up hand-over (e.g. for an item not handed over the first time) can be added from New visit.
    const followUp = await createJob(ownerId, { type: "DELIVERY", customerId, serviceAddressId: addressId,
      agreementId: rental.agreementId, customerPickupHandoff: true });
    expect(followUp).toMatchObject({ type: "DELIVERY", customerPickupHandoff: true });
  });

  it("completing the hand-over starts the rental exactly like a delivery, with no truck trip recorded", async () => {
    const pickup = await signedRental("CUSTOMER_PICKUP");
    const truck = await signedRental("DELIVER");
    const today = new Date();
    for (const job of [pickup.jobId, truck.jobId])
      await prisma.job.update({ where: { id: job }, data: { scheduledAt: today } });
    // The driver's route for today has the delivery, never the hand-over.
    const route = (await getDriverJobsForToday()).map((job) => job.id);
    expect(route).toContain(truck.jobId);
    expect(route).not.toContain(pickup.jobId);

    for (const rental of [pickup, truck]) {
      await prisma.job.update({ where: { id: rental.jobId }, data: { status: "IN_PROGRESS" } });
      const outcome = await finish(rental.jobId, rental.applianceId);
      expect(outcome.outcome).toBe("COMPLETE");
    }
    for (const rental of [pickup, truck]) {
      const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: rental.agreementId } });
      expect(agreement.firstDeliveredOn).not.toBeNull();
      expect(agreement.continuityRootId).toBe(rental.agreementId);
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id: rental.applianceId } })).status).toBe("RENTED");
      expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: rental.applianceId, customerId, endedOn: null } })).toBe(1);
      expect(await prisma.jobBillingHandoff.findMany({ where: { jobId: rental.jobId }, select: { kind: true, subjectId: true } }))
        .toEqual([{ kind: "START_RECURRING_BILLING", subjectId: rental.agreementId }]);
      expect(m.start).toHaveBeenCalledWith(rental.agreementId);
    }
    // No delivery happened for the pickup: no delivery count toward the city license rule, no retail delivery fee.
    expect(await prisma.jurisdictionDeliveryCount.count({ where: { orderId: pickup.agreementId } })).toBe(0);
    expect(await prisma.retailDeliveryFeeRecord.count({ where: { agreementId: pickup.agreementId } })).toBe(0);
    expect(await prisma.jurisdictionDeliveryCount.count({ where: { orderId: truck.agreementId, jurisdictionId } })).toBe(1);
  });

  it("a city's delivery-license rule stops a delivery but not a customer pickup (Codex finding on PR #604)", async () => {
    const { assertDeliveryReadyInTx } = await import("@/domains/tax/delivery-readiness");
    await prisma.jurisdictionReadiness.create({ data: { jurisdictionId, licenseRequired: "ALWAYS" } });
    try {
      await expect(prisma.$transaction((tx) => assertDeliveryReadyInTx(tx, { serviceAddressId: addressId })))
        .rejects.toThrow();
      await expect(prisma.$transaction((tx) => assertDeliveryReadyInTx(tx, { serviceAddressId: addressId, customerPickup: true })))
        .resolves.toBeUndefined();
      // A self-collected place whose rental tax rule isn't decided still stops a pickup, even when the place also
      // needs a delivery license (the license check is skipped, not filtered after it hid the undecided rule).
      await prisma.taxJurisdiction.update({ where: { id: jurisdictionId }, data: { administration: "SELF_COLLECTED" } });
      await prisma.taxabilityRule.deleteMany({ where: { jurisdictionId, category: "RENTAL" } });
      await expect(prisma.$transaction((tx) => assertDeliveryReadyInTx(tx, { serviceAddressId: addressId, customerPickup: true })))
        .rejects.toThrow(/rental tax rule/);
    } finally {
      await prisma.jurisdictionReadiness.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.update({ where: { id: jurisdictionId }, data: { administration: "STATE_COLLECTED" } });
    }
  });
});
