import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JobApplianceResult } from "@prisma/client";

const m = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/domains/billing/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domains/billing/checkout")>()),
  startRecurringBillingForAgreement: m.start,
}));

import { prisma } from "@/lib/prisma";
import { completeJob, updateJobStatus } from "@/domains/jobs";
import { markJobNoShow } from "@/domains/jobs/scheduling";
import { stageSwap } from "@/domains/inventory/guided-actions";
import { endAgreement } from "@/domains/agreements";
import { businessDateFromKey } from "@/lib/business-date";

// Swaps (Batch C, P2-C), real Postgres: staging reserves only the replacement; completion moves everything at once.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("swaps", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `sw-owner-${tag}`;
  const userId = `sw-user-${tag}`;
  const customerId = `sw-customer-${tag}`;
  const addressId = `sw-address-${tag}`;
  const typeId = `sw-type-${tag}`;
  const otherTypeId = `sw-type2-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const key = () => `sw-key-${randomUUID()}`;

  /** A fresh agreement with one line, so each test starts clean (an agreement can end in one of them). */
  async function agreement() {
    const id = `sw-agreement-${agreementIds.length}-${tag}`;
    agreementIds.push(id);
    await prisma.rentalAgreement.create({
      data: { id, customerId, serviceAddressId: addressId, status: "ACTIVE", lines: { create: { label: "Set", monthlyPriceCents: 6000, listPriceCents: 6000 } } },
    });
    return { id, lineId: (await prisma.rentalLine.findFirstOrThrow({ where: { agreementId: id } })).id };
  }
  async function unit(status: "AVAILABLE" | "RESERVED" | "RENTED" | "MAINTENANCE", type = typeId) {
    const id = `sw-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `SW${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: type, status } });
    return id;
  }
  /** A rented unit on the agreement's line, with its customer recorded as holding it. */
  async function rentedUnit(a: { lineId: string }) {
    const id = await unit("RENTED");
    await prisma.applianceAssignment.create({ data: { rentalLineId: a.lineId, applianceId: id } });
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: id, customerId, startEvidence: "MANUAL" } });
    return id;
  }
  const status = async (id: string) => (await prisma.appliance.findUniqueOrThrow({ where: { id } })).status;
  const openAssignment = (id: string) => prisma.applianceAssignment.findFirst({ where: { applianceId: id, unassignedAt: null } });
  const openCustody = (id: string) => prisma.applianceCustodyEpisode.count({ where: { applianceId: id, closedAt: null } });
  async function staged(a: { lineId: string }) {
    const original = await rentedUnit(a);
    const replacement = await unit("AVAILABLE");
    const { jobId } = await stageSwap(ownerId, { originalApplianceId: original, replacementApplianceId: replacement, scheduledAt: new Date() });
    jobIds.push(jobId);
    await prisma.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
    return { original, replacement, jobId };
  }
  const finish = (jobId: string, results: Array<[string, JobApplianceResult]>) =>
    completeJob(ownerId, { jobId, expectedVersion: 1, completionKey: key(), performedOn: businessDateFromKey("2026-09-12"), completionNotes: null, results: results.map(([applianceId, result]) => ({ applianceId, result })) });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "SW Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "SW Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `S${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Swap St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.createMany({ data: [{ id: typeId, name: `SW ${tag}`, slug: `sw-${tag}` }, { id: otherTypeId, name: `SW2 ${tag}`, slug: `sw2-${tag}` }] });
  });

  afterAll(async () => {
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: ownerId }, { entityType: "Appliance", entityId: { in: applianceIds } }, { entityType: "Job", entityId: { in: jobIds } }, { entityType: "RentalAgreement", entityId: { in: agreementIds } }] },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreement: { customerId } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [typeId, otherTypeId] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("swap-stage-reserves-only-replacement: nothing else moves while the swap waits", async () => {
    const a = await agreement();
    const { original, replacement, jobId } = await staged(a);
    expect(await status(replacement)).toBe("RESERVED");
    expect(await prisma.jobAppliance.findFirstOrThrow({ where: { jobId, applianceId: replacement } })).toMatchObject({ role: "REPLACEMENT", reservationActive: true });
    expect(await prisma.jobAppliance.findFirstOrThrow({ where: { jobId, applianceId: original } })).toMatchObject({ role: "PRIMARY", reservationActive: false });
    expect(await status(original)).toBe("RENTED");
    expect((await openAssignment(original))?.rentalLineId).toBe(a.lineId);
    expect(await openAssignment(replacement)).toBeNull();
    expect(await openCustody(original)).toBe(1);
    expect(await openCustody(replacement)).toBe(0);
  });

  it("swap-stage-refusals: needs a recorded holder, an available same-type replacement, and one waiting swap at a time", async () => {
    const a = await agreement();
    const noHolder = await unit("RENTED");
    await prisma.applianceAssignment.create({ data: { rentalLineId: a.lineId, applianceId: noHolder } });
    const free = await unit("AVAILABLE");
    await expect(stageSwap(ownerId, { originalApplianceId: noHolder, replacementApplianceId: free, scheduledAt: null })).rejects.toThrow(/no customer recorded/);
    const original = await rentedUnit(a);
    await expect(stageSwap(ownerId, { originalApplianceId: original, replacementApplianceId: await unit("AVAILABLE", otherTypeId), scheduledAt: null })).rejects.toThrow(/same appliance type/);
    await expect(stageSwap(ownerId, { originalApplianceId: original, replacementApplianceId: await unit("RESERVED"), scheduledAt: null })).rejects.toThrow(/isn't currently available/);
    await expect(stageSwap(ownerId, { originalApplianceId: await unit("AVAILABLE"), replacementApplianceId: free, scheduledAt: null })).rejects.toThrow(/nothing to swap/);
    const { jobId } = await stageSwap(ownerId, { originalApplianceId: original, replacementApplianceId: free, scheduledAt: null });
    jobIds.push(jobId);
    await expect(stageSwap(ownerId, { originalApplianceId: original, replacementApplianceId: await unit("AVAILABLE"), scheduledAt: null })).rejects.toThrow(/already waiting/);
  });

  it("swap-stage-race: two swaps cannot reserve the same replacement", async () => {
    const a = await agreement();
    const one = await rentedUnit(a);
    const two = await rentedUnit(a);
    const replacement = await unit("AVAILABLE");
    const results = await Promise.allSettled([
      stageSwap(ownerId, { originalApplianceId: one, replacementApplianceId: replacement, scheduledAt: null }),
      stageSwap(ownerId, { originalApplianceId: two, replacementApplianceId: replacement, scheduledAt: null }),
    ]);
    for (const r of results) if (r.status === "fulfilled") jobIds.push(r.value.jobId);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.jobAppliance.count({ where: { applianceId: replacement, reservationActive: true } })).toBe(1);
  });

  it("swap-complete-both-moves: new unit rented and assigned, old unit to inspection, custody follows", async () => {
    const a = await agreement();
    const { original, replacement, jobId } = await staged(a);
    const done = await finish(jobId, [[original, "RETURNED"], [replacement, "DELIVERED"]]);
    expect(done.outcome).toBe("COMPLETE");
    expect(await status(replacement)).toBe("RENTED");
    expect(await status(original)).toBe("AWAITING_INSPECTION");
    expect((await openAssignment(replacement))?.rentalLineId).toBe(a.lineId);
    expect(await openAssignment(original)).toBeNull();
    expect(await prisma.applianceAssignment.findFirstOrThrow({ where: { applianceId: original } })).toMatchObject({ unassignReason: expect.stringMatching(/^Swapped for SW/) });
    expect(await openCustody(replacement)).toBe(1);
    expect(await openCustody(original)).toBe(0);
    expect(await prisma.applianceCustodyEpisode.findFirstOrThrow({ where: { applianceId: original } })).toMatchObject({ endReason: "Swapped out" });
    expect(await prisma.jobAppliance.count({ where: { jobId, reservationActive: true } })).toBe(0);
    expect(await prisma.staffTask.count({ where: { jobId } })).toBe(0);
  });

  it("swap-complete-neither-moved: the reservation is released, nothing else changes, one task to reschedule", async () => {
    const a = await agreement();
    const { original, replacement, jobId } = await staged(a);
    const done = await finish(jobId, [[original, "NOT_RETURNED"], [replacement, "NOT_DELIVERED"]]);
    expect(done.outcome).toBe("PARTIAL");
    expect(await status(replacement)).toBe("AVAILABLE");
    expect(await status(original)).toBe("RENTED");
    expect((await openAssignment(original))?.rentalLineId).toBe(a.lineId);
    expect(await openCustody(original)).toBe(1);
    expect(await openCustody(replacement)).toBe(0);
    const tasks = await prisma.staffTask.findMany({ where: { jobId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ priority: "HIGH", note: expect.stringMatching(/Reschedule the swap/) });
    expect(await prisma.jobAppliance.count({ where: { jobId, reservationActive: true } })).toBe(0);
  });

  it("swap-complete-old-left-behind: the new unit takes over, the old one stays rented with its own stay, and a task says to collect it", async () => {
    const a = await agreement();
    const { original, replacement, jobId } = await staged(a);
    const done = await finish(jobId, [[original, "NOT_RETURNED"], [replacement, "DELIVERED"]]);
    expect(done.outcome).toBe("PARTIAL");
    expect(await status(replacement)).toBe("RENTED");
    expect(await status(original)).toBe("RENTED");
    expect((await openAssignment(replacement))?.rentalLineId).toBe(a.lineId);
    expect(await openAssignment(original)).toBeNull();
    expect(await openCustody(original)).toBe(1);
    expect(await openCustody(replacement)).toBe(1);
    const tasks = await prisma.staffTask.findMany({ where: { jobId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].note).toMatch(/Collect .*SW/);
  });

  it("swap-complete-old-returned-new-not-delivered-refused: nothing changes", async () => {
    const a = await agreement();
    const { original, replacement, jobId } = await staged(a);
    await expect(finish(jobId, [[original, "RETURNED"], [replacement, "NOT_DELIVERED"]])).rejects.toThrow(/Don't take the old unit/);
    expect(await status(replacement)).toBe("RESERVED");
    expect(await status(original)).toBe("RENTED");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("IN_PROGRESS");
  });

  it("swap-follows-assignment-after-renewal: a swap completes against the original's current agreement", async () => {
    const a = await agreement();
    const b = await agreement();
    const { original, replacement, jobId } = await staged(a);
    // A renewal moved the original onto the next agreement's line while the swap was waiting.
    await prisma.applianceAssignment.updateMany({ where: { applianceId: original, unassignedAt: null }, data: { unassignedAt: new Date(), unassignReason: "Renewed" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: b.lineId, applianceId: original } });
    await finish(jobId, [[original, "RETURNED"], [replacement, "DELIVERED"]]);
    expect((await openAssignment(replacement))?.rentalLineId).toBe(b.lineId);
    expect(await openAssignment(original)).toBeNull();
  });

  it("swap-cancel-releases: cancelling, a no-show, and ending the agreement all give the reserved unit back", async () => {
    const a = await agreement();
    const cancelled = await staged(a);
    await updateJobStatus(ownerId, cancelled.jobId, "CANCELLED");
    expect(await status(cancelled.replacement)).toBe("AVAILABLE");
    expect(await prisma.jobAppliance.count({ where: { jobId: cancelled.jobId, reservationActive: true } })).toBe(0);
    expect(await status(cancelled.original)).toBe("RENTED");

    const noShow = await staged(a);
    await markJobNoShow(ownerId, noShow.jobId, 1);
    expect(await status(noShow.replacement)).toBe("AVAILABLE");

    const ending = await staged(a);
    await endAgreement(ownerId, a.id);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: ending.jobId } })).status).toBe("CANCELLED");
    expect(await status(ending.replacement)).toBe("AVAILABLE");
    expect(await prisma.jobAppliance.count({ where: { jobId: ending.jobId, reservationActive: true } })).toBe(0);
  });

  it("swap-vs-ending-race: finishing a swap and ending the agreement together never leaves a half-moved swap", async () => {
    const a = await agreement();
    const { original, replacement, jobId } = await staged(a);
    await Promise.allSettled([
      finish(jobId, [[original, "RETURNED"], [replacement, "DELIVERED"]]),
      endAgreement(ownerId, a.id),
    ]);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(["COMPLETED", "CANCELLED"]).toContain(job.status);
    if (job.status === "COMPLETED") {
      expect(await status(replacement)).not.toBe("AVAILABLE");
      expect(await openCustody(replacement)).toBe(1);
      expect(await openCustody(original)).toBe(0);
    } else {
      expect(await status(replacement)).toBe("AVAILABLE");
      expect(await openCustody(replacement)).toBe(0);
    }
    expect(await prisma.applianceAssignment.count({ where: { rentalLine: { agreementId: a.id }, unassignedAt: null } })).toBe(0);
    expect(await prisma.jobAppliance.count({ where: { jobId, reservationActive: true } })).toBe(0);
  });
});
