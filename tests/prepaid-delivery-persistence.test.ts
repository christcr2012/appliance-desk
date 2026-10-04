import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ stripe: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: m.stripe }));
import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)("prepaid delivery in disposable Postgres", () => {
  const tag = randomUUID(); const agreementId = `prepaid-${tag}`; const jobId = `prepaid-job-${tag}`; const applianceId = `prepaid-unit-${tag}`;
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [agreementId, jobId, applianceId] } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId } });
    await prisma.jobAppliance.deleteMany({ where: { jobId } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: applianceId } });
  });
  it("completes real delivery and clears stale billing error without creating recurring charges or receipts", async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const address = await prisma.serviceAddress.findFirstOrThrow();
    const type = await prisma.applianceType.findFirstOrThrow();
    await prisma.appliance.create({ data: { id: applianceId, assetNumber: applianceId, applianceTypeId: type.id, status: "RESERVED" } });
    await prisma.rentalAgreement.create({ data: { id: agreementId, customerId: address.customerId, serviceAddressId: address.id, status: "ACTIVE", termMonths: 12, paidInFullInAdvance: true, freeMonthGranted: true, billingBlockedReason: "Missing payment method", lines: { create: { label: "Prepaid washer", monthlyPriceCents: 4000 } } } });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId } });
    await prisma.job.create({ data: { id: jobId, type: "DELIVERY", status: "IN_PROGRESS", agreementId, appliances: { create: { applianceId } } } });
    await completeJob(owner.id, { jobId, expectedVersion: 1, completionKey: `prepaid-key-${tag}`, performedOn: null, completionNotes: null, results: [{ applianceId, result: "DELIVERED" }] });
    await startRecurringBillingForAgreement(agreementId);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("COMPLETED");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } })).status).toBe("RENTED");
    expect(await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreementId } })).toMatchObject({ paidInFullInAdvance: true, stripeSubscriptionId: null, billingBlockedReason: null, billingStartedAt: null });
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0);
    expect(m.stripe).not.toHaveBeenCalled();
  });
});
