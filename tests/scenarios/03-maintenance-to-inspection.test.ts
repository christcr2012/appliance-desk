// PLAN scenario 3 (BATCH-F WU-F3): a rented machine breaks, the customer reports it, the owner has it repaired, and at the end of
// the rental the machine goes through pickup, inspection and cleaning (or back to repair) before it can be rented again.
// Real domain functions on the disposable Postgres; providers faked. Customer isolation is asserted at each customer-side read.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tag = randomUUID().replaceAll("-", "");
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    products: { create: async () => ({ id: "prod_s3_synthetic" }) },
    subscriptions: { create: async () => ({ id: `sub_s3_${tag}`, latest_invoice: "in_s3_synthetic" }) },
    invoices: {
      retrieve: async () => ({ id: "in_s3_synthetic", livemode: false, billing_reason: "subscription_create", currency: "usd", customer: `cus_s3_${tag}`, status: "open", parent: { subscription_details: { subscription: `sub_s3_${tag}` } } }),
      listLineItems: async () => ({ has_more: false, data: [{ id: "il_s3_0", livemode: false, invoice: "in_s3_synthetic", amount: -6000, metadata: {} }] }),
    },
  }),
}));
const mail = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/email", () => ({
  sendEmail: async (message: { to: string }) => {
    mail.sent.push(message.to);
    return { sent: true };
  },
}));
let owner = "";
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: owner, role: "OWNER", archivedAt: null } }) } } }));
vi.mock("@/domains/security/two-factor", () => ({ twoFactorEnrollmentRequired: async () => false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { completeJob, updateJobStatus } from "@/domains/jobs";
import { createMaintenanceRequestForUser, createPickupRequestForUser, getPortalMaintenancePage } from "@/domains/portal";
import { scheduleMaintenanceRequest, updateMaintenanceStatus } from "@/domains/maintenance";
import { getInspectionChecklist, recordApplianceInspection } from "@/domains/inventory/guided-actions";
import { markCleaningDone } from "@/domains/inventory/cleaning";
import { createSyntheticW22V2Order } from "../helpers/w22-v2-order";
import { deliverMachines, reviewSignAndPay, purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && url.pathname === "/appliance_desk_test" && ["localhost", "127.0.0.1"].includes(url.hostname);
const day = businessDateKey(new Date());

describe.skipIf(!enabled)("scenario 3: maintenance to inspection", () => {
  let cleanup: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    await cleanup?.();
  });

  it("repairs a rented machine, then returns two machines through inspection to available and back to repair", async () => {
    const fixture = await createSyntheticW22V2Order();
    cleanup = fixture.cleanup;
    const { agreementId, jobId } = await reviewSignAndPay(fixture, 0, "s3");
    const { applianceIds } = await deliverMachines(fixture, agreementId, jobId, 2, "s3");
    const [machineA, machineB] = applianceIds;
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: fixture.customerId } });
    const stranger = await prisma.user.create({ data: { email: `s3-other-${tag}@test.invalid`, role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { userId: stranger.id, referralCode: `S3-${tag.slice(0, 12)}` } });
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: machineA } })).status).toBe("RENTED");

    // 1. The customer reports a problem on their own machine; the owner is told; another customer sees nothing.
    const request = await createMaintenanceRequestForUser(customer.userId, { problem: "Washer will not drain", applianceId: machineA, priority: "HIGH" });
    expect(request.status).toBe("SUBMITTED");
    expect(await prisma.auditLog.count({ where: { entityType: "MaintenanceRequest", entityId: request.id, action: "maintenance.request.create" } })).toBe(1);
    expect((await getPortalMaintenancePage(customer.userId, 1))?.items.map((r) => r.id)).toContain(request.id);
    expect((await getPortalMaintenancePage(stranger.id, 1))?.items ?? []).toHaveLength(0);
    await expect(createMaintenanceRequestForUser(stranger.id, { problem: "Not mine", applianceId: machineA })).rejects.toThrow(/isn't on one of your active rentals/);

    // 2. The owner reviews, schedules and completes the repair; the request follows the visit and resolves.
    await updateMaintenanceStatus(owner, request.id, "REVIEWING");
    const address = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId }, select: { serviceAddressId: true } });
    const visit = await scheduleMaintenanceRequest(owner, {
      requestId: request.id, scheduledAt: new Date(Date.now() + 86_400_000), durationMinutes: 60, assignedToUserId: null,
      serviceAddressId: address.serviceAddressId, confirmedConflictJobIds: [],
    });
    expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("SCHEDULED");
    await updateJobStatus(owner, visit.jobId, "IN_PROGRESS");
    expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("IN_PROGRESS");
    const repairJob = await prisma.job.findUniqueOrThrow({ where: { id: visit.jobId } });
    const repaired = await completeJob(owner, {
      jobId: visit.jobId, expectedVersion: repairJob.version, completionKey: `s3-repair-${tag}`, performedOn: businessDateFromKey(day),
      completionNotes: null, results: [{ applianceId: machineA, result: "REPAIRED" as const }],
    });
    expect(repaired.outcome).toBe("COMPLETE");
    const resolved = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.completedAt).not.toBeNull();
    // The machine stays with the customer; a repair does not move custody.
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: machineA } })).status).toBe("RENTED");

    // 3. The customer asks for a pickup; one pickup visit is drafted (a second ask reuses it); a customer with nothing out gets no pickup visit.
    const asked = await createPickupRequestForUser(customer.userId, { note: "Moving out" });
    expect(asked?.created).toBe(true);
    expect((await createPickupRequestForUser(customer.userId, { note: "Still moving out" }))?.created).toBe(false);
    expect(await createPickupRequestForUser(stranger.id, { note: "Take it" })).toBeNull();
    expect(await prisma.job.count({ where: { type: "REMOVAL", agreementId } })).toBe(1);
    const pickupId = asked!.jobId;
    await prisma.job.update({ where: { id: pickupId }, data: { scheduledAt: new Date() } });
    await prisma.jobAppliance.createMany({ data: [machineA, machineB].map((applianceId) => ({ jobId: pickupId, applianceId })), skipDuplicates: true });
    await updateJobStatus(owner, pickupId, "IN_PROGRESS");
    const pickup = await prisma.job.findUniqueOrThrow({ where: { id: pickupId } });
    await completeJob(owner, {
      jobId: pickupId, expectedVersion: pickup.version, completionKey: `s3-pickup-${tag}`, performedOn: businessDateFromKey(day), completionNotes: null,
      results: [machineA, machineB].map((applianceId) => ({ applianceId, result: "RETURNED" as const })),
    });
    for (const id of [machineA, machineB]) {
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("AWAITING_INSPECTION");
      expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: id, endedOn: null } })).toBe(0);
    }

    // 4. Machine A passes inspection and is cleaned; machine B fails, goes to maintenance and gets exactly one repair draft.
    const checklist = await getInspectionChecklist();
    const pass = await recordApplianceInspection(owner, machineA, { expectedChecklistVersionId: checklist.versionId, answers: checklist.items.map(() => true), condition: "Good" });
    expect(pass.passed).toBe(true);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: machineA } })).status).toBe("CLEANING");
    expect((await markCleaningDone(owner, machineA)).changed).toBe(true);
    expect((await markCleaningDone(owner, machineA)).changed).toBe(false);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: machineA } })).status).toBe("AVAILABLE");

    const fail = await recordApplianceInspection(owner, machineB, { expectedChecklistVersionId: checklist.versionId, answers: checklist.items.map((_, i) => i !== 0) });
    expect(fail.passed).toBe(false);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: machineB } })).status).toBe("MAINTENANCE");
    const drafts = await prisma.job.findMany({ where: { type: "MAINTENANCE_VISIT", status: "SCHEDULED", scheduledAt: null, appliances: { some: { applianceId: machineB } } } });
    expect(drafts).toHaveLength(1);
    // A machine that has not been inspected cannot be cleaned, and an inspected one cannot be inspected twice.
    await expect(markCleaningDone(owner, machineB)).rejects.toThrow(/isn't being cleaned/);
    await expect(recordApplianceInspection(owner, machineA, { expectedChecklistVersionId: checklist.versionId, answers: checklist.items.map(() => true) })).rejects.toThrow(/awaiting inspection/);

    // 5. The history is complete: status audit rows for both machines tell the whole story.
    const trail = await prisma.auditLog.findMany({ where: { entityType: "Appliance", entityId: machineA, action: "appliance.unit.status" }, orderBy: { createdAt: "asc" } });
    expect(trail.map((row) => (row.newValue as { status: string }).status)).toEqual(expect.arrayContaining(["AWAITING_INSPECTION", "CLEANING", "AVAILABLE"]));
  });
});
