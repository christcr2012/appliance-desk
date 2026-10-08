import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { prisma } from "@/lib/prisma";
import { recordLateDeliveries } from "@/domains/billing/pickup-billing-events";
import { completeJob } from "@/domains/jobs";
import type { JobApplianceResult } from "@prisma/client";
import { businessDateFromKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

// Two delivery jobs finishing at the same moment must not each credit the same missing item, and a unit that is
// already out with the customer cannot be marked "not delivered" (PR #167 review findings, real Postgres).
describe.skipIf(!enabled)("late-delivery credit safety (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `race-owner-${tag}`;
  const userId = `race-user-${tag}`;
  const customerId = `race-customer-${tag}`;
  const addressId = `race-address-${tag}`;
  const agreementId = `race-agreement-${tag}`;
  const typeId = `race-type-${tag}`;
  const dryerId = `race-dryer-${tag}`;
  const washerId = `race-washer-${tag}`;
  const originalJobId = `race-job0-${tag}`;
  const jobA = `race-jobA-${tag}`;
  const jobB = `race-jobB-${tag}`;
  const rentedJob = `race-job3-${tag}`;
  let pendingId = "";
  const finish = (jobId: string, results: Array<{ applianceId: string; result: JobApplianceResult }>, performedOn: string | null = null) =>
    completeJob(ownerId, {
      jobId,
      expectedVersion: 1,
      completionKey: `race-key-${randomUUID()}`,
      performedOn: performedOn ? businessDateFromKey(performedOn) : null,
      completionNotes: null,
      results,
    });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `${tag}-o@example.test`, name: "Owner fixture", role: "OWNER" } });
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Race fixture", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R${tag.slice(0, 18)}`, stripeCustomerId: `cus_${tag}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Denver", zip: "80201" } });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        billingStartedAt: businessDateFromKey("2026-09-01")!,
        lines: { create: { label: "Set", monthlyPriceCents: 6000, listPriceCents: 6000 } },
      },
    });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    await prisma.applianceType.create({ data: { id: typeId, name: `T ${tag}`, slug: `t-${tag}`, monthlyPriceCents: 3000 } });
    await prisma.appliance.create({ data: { id: washerId, assetNumber: `RW-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
    await prisma.appliance.create({ data: { id: dryerId, assetNumber: `RD-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RESERVED" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: washerId } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: dryerId } });
    for (const id of [originalJobId, jobA, jobB]) {
      await prisma.job.create({ data: { id, type: "DELIVERY", status: "IN_PROGRESS", customerId, agreementId } });
    }
    await prisma.job.create({
      data: { id: rentedJob, type: "DELIVERY", status: "IN_PROGRESS", customerId, agreementId, appliances: { create: [{ applianceId: washerId }] } },
    });
    const pending = await prisma.pendingDelivery.create({
      data: { agreementId, rentalLineId: line.id, applianceId: dryerId, originalJobId, originalDeliveryDate: businessDateFromKey("2026-09-01")! },
    });
    pendingId = pending.id;
  });

  const extraApplianceIds: string[] = [];
  const extraJobIds: string[] = [];

  afterAll(async () => {
    // Clean up only this file's own rows (other integration files run in parallel on the same database).
    const pendingIds = (await prisma.pendingDelivery.findMany({ where: { agreementId }, select: { id: true } })).map((r) => r.id);
    const creditIds = (await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } })).map((r) => r.id);
    const allApplianceIds = [dryerId, washerId, ...extraApplianceIds];
    const allJobIds = [originalJobId, jobA, jobB, rentedJob, ...extraJobIds];
    await prisma.staffTask.deleteMany({ where: { jobId: { in: allJobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: allJobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: allApplianceIds } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: ownerId },
          { entityType: "PendingDelivery", entityId: { in: pendingIds } },
          { entityType: "CustomerCredit", entityId: { in: creditIds } },
          { entityType: "Appliance", entityId: { in: allApplianceIds } },
          { entityType: "Job", entityId: { in: allJobIds } },
        ],
      },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: allApplianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: allJobIds } } });
    await prisma.retailDeliveryFeeRecord.deleteMany({ where: { firstJobId: { in: allJobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: allJobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: { in: allApplianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
  });

  it("two jobs delivering the same missing item at once issue exactly one credit", async () => {
    const run = (jobId: string) =>
      prisma.$transaction((tx) =>
        recordLateDeliveries(tx, {
          userId: ownerId,
          jobId,
          agreementId,
          applianceIds: [dryerId],
          deliveryDate: businessDateFromKey("2026-09-11")!,
        }),
      );
    const results = await Promise.all([run(jobA), run(jobB)]);
    expect(results.flatMap((r) => r.creditIds)).toHaveLength(1);
    expect(await prisma.customerCredit.count({ where: { customerId, sourceType: "LATE_DELIVERY" } })).toBe(1);
    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: pendingId } });
    expect(row.deliveredOn).not.toBeNull();
    expect(row.creditId).not.toBeNull();
  });

  it("a unit already out with the customer cannot be marked not delivered", async () => {
    await expect(
      finish(rentedJob, [{ applianceId: washerId, result: "NOT_DELIVERED" }]),
    ).rejects.toThrow(/not waiting for delivery/);
    const washer = await prisma.appliance.findUniqueOrThrow({ where: { id: washerId } });
    expect(washer.status).toBe("RENTED");
    expect(await prisma.pendingDelivery.count({ where: { applianceId: washerId } })).toBe(0);
  });

  it("a delivery cannot be recorded as done in the future", async () => {
    await expect(
      finish(rentedJob, [{ applianceId: washerId, result: "DELIVERED" }], "2099-01-01"),
    ).rejects.toThrow(/cannot be in the future/);
  });

  it("a delivery and a 'not delivered' mark for the same unit never leave a waiting item on a delivered unit", async () => {
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    for (let i = 0; i < 6; i++) {
      const unitId = `race-x${i}-${tag}`;
      const deliverJob = `race-xd${i}-${tag}`;
      const missJob = `race-xm${i}-${tag}`;
      extraApplianceIds.push(unitId);
      extraJobIds.push(deliverJob, missJob);
      await prisma.appliance.create({ data: { id: unitId, assetNumber: `RX${i}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RESERVED" } });
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: unitId } });
      for (const id of [deliverJob, missJob]) {
        await prisma.job.create({
          data: { id, type: "DELIVERY", status: "IN_PROGRESS", customerId, agreementId, appliances: { create: [{ applianceId: unitId }] } },
        });
      }
      const results = await Promise.allSettled([
        finish(deliverJob, [{ applianceId: unitId, result: "DELIVERED" }], "2026-09-12"),
        finish(missJob, [{ applianceId: unitId, result: "NOT_DELIVERED" }], "2026-09-12"),
      ]);
      expect(results[0].status).toBe("fulfilled");
      const unit = await prisma.appliance.findUniqueOrThrow({ where: { id: unitId } });
      expect(unit.status).toBe("RENTED");
      // Whichever finished first, no waiting item is left behind for a unit that is now out with the customer.
      const waiting = await prisma.pendingDelivery.count({ where: { applianceId: unitId, deliveredOn: null, removedAt: null } });
      expect(waiting).toBe(0);
      if (results[1].status === "rejected") expect(String(results[1].reason)).toMatch(/not waiting for delivery/);
    }
  });
});
