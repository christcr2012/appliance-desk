// PLAN scenario 12 (BATCH-F WU-F3): three pickups happen four days after the agreed end. When the customer caused the delay the
// late days are charged; when the company caused it, the owner records the waiver and exactly those days (and their tax) come
// off, once; a partial waiver takes off only the days named. Staff cannot waive, a replay changes nothing. Integer cents.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { businessDateFromKey } from "@/lib/business-date";
import { openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import { getLateReturnWaiverState, recordLateReturnWaiver } from "@/domains/billing/late-return-waiver";
import { seedTaxReadyContext } from "../helpers/tax-ready";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("scenario 12: late pickup and the company-delay waiver", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `sc12-owner-${tag}`;
  const staffId = `sc12-staff-${tag}`;
  const userId = `sc12-user-${tag}`;
  const customerId = `sc12-customer-${tag}`;
  const addressId = `sc12-address-${tag}`;
  const typeId = `sc12-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const octEnd = new Date("2025-11-01T05:59:59Z"); // the end of Colorado's October 31, 2025
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  async function lateRental() {
    const agreementId = `sc12-ag-${agreementIds.length}-${tag}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths: 12, endDate: octEnd, taxRateMilliPercent: 7000,
        firstDeliveredOn: new Date("2024-11-01T06:00:00Z"), lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } },
      },
    });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    const setupId = `sc12-setup-${jobIds.length}-${tag}`;
    jobIds.push(setupId);
    await prisma.job.create({ data: { id: setupId, type: "DELIVERY", status: "COMPLETED", customerId, serviceAddressId: addressId, agreementId } });
    const unit = `sc12-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(unit);
    await prisma.appliance.create({ data: { id: unit, assetNumber: `S12${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: unit } });
    await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { applianceId: unit, customerId, serviceAddressId: addressId, agreementId, startedOn: new Date("2024-11-01T06:00:00Z"), startJobId: setupId }));
    // The pickup is completed on November 5: four days after the agreed end.
    const jobId = `sc12-job-${jobIds.length}-${tag}`;
    jobIds.push(jobId);
    await prisma.job.create({ data: { id: jobId, type: "REMOVAL", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId, appliances: { create: [{ applianceId: unit }] } } });
    await completeJob(ownerId, { jobId, expectedVersion: 1, completionKey: `sc12-key-${randomUUID()}`, performedOn: businessDateFromKey("2025-11-05"), completionNotes: null, results: [{ applianceId: unit, result: "RETURNED" as const }] });
    return { agreementId, jobId };
  }
  const lateInvoice = async (jobId: string) => {
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "billing.late_return_invoiced", newValue: { path: ["jobId"], equals: jobId } } });
    return prisma.invoice.findUniqueOrThrow({ where: { id: audit.entityId! }, include: { lineItems: true } });
  };

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${tag}-o@example.test`, name: "SC12 Owner", role: "OWNER", emailVerified: true },
      { id: staffId, email: `${tag}-s@example.test`, name: "SC12 Staff", role: "STAFF", emailVerified: true },
      { id: userId, email: `${tag}-c@example.test`, name: "SC12 Customer", role: "CUSTOMER", emailVerified: true },
    ] });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `L${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "12 Scenario St", city: "Greeley", zip: "80631" } });
    taxFixture = await seedTaxReadyContext(addressId, { rateMilliPercent: 7_000 });
    await prisma.applianceType.create({ data: { id: typeId, name: `SC12 ${tag}`, slug: `sc12-${tag}` } });
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const invoices = (await prisma.invoice.findMany({ where: { customerId }, select: { id: true } })).map((i) => i.id);
    await prisma.lateReturnWaiver.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, staffId] } }, { entityId: { in: [...invoices, ...agreementIds, ...jobIds, ...applianceIds] } }] } });
    await prisma.outOfServicePeriod.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, userId] } } });
  });

  it("the customer's delay is charged, the company's delay is waived exactly as recorded, and a replay changes nothing", async () => {
    const theirs = await lateRental(); // customer's fault: nobody waives
    const ours = await lateRental(); // company's fault: all days waived
    const partial = await lateRental(); // company's fault for one of the four days

    // What was charged: four days of a $30 monthly rate (400 cents) plus 7% tax (28 cents).
    for (const job of [theirs.jobId, ours.jobId, partial.jobId]) {
      const invoice = await lateInvoice(job);
      expect(invoice).toMatchObject({ subtotalCents: 400, taxCents: 28, amountDueCents: 428, amountPaidCents: 0, status: "OPEN" });
      expect(invoice.lineItems.filter((l) => l.kind === "LATE_RETURN").map((l) => l.amountCents)).toEqual([400]);
    }
    expect(await getLateReturnWaiverState(ours.jobId)).toMatchObject({ kind: "AVAILABLE", maxDays: 4, chargedCents: 428 });

    // Only the owner or an admin can waive, and a note is required.
    await expect(recordLateReturnWaiver(staffId, ours.jobId, { waivedDays: null, note: "Staff may not waive" })).rejects.toThrow();
    await expect(recordLateReturnWaiver(ownerId, ours.jobId, { waivedDays: null, note: "no" })).rejects.toThrow(/note/i);
    expect(await prisma.lateReturnWaiver.count({ where: { jobId: ours.jobId } })).toBe(0);

    // All four days waived: the late charge and its tax come off; the original charge stays on the invoice for the record.
    await recordLateReturnWaiver(ownerId, ours.jobId, { waivedDays: null, note: "Our truck was late" });
    const waived = await lateInvoice(ours.jobId);
    expect(waived).toMatchObject({ subtotalCents: 0, taxCents: 0, amountDueCents: 0, status: "PAID" });
    expect(waived.lineItems.filter((l) => l.kind === "LATE_RETURN").map((l) => l.amountCents)).toEqual([400]);
    expect(waived.lineItems.filter((l) => l.kind === "LATE_RETURN_WAIVER").map((l) => l.amountCents)).toEqual([-400]);
    expect(await prisma.lateReturnWaiver.findUniqueOrThrow({ where: { jobId: ours.jobId } })).toMatchObject({ waivedDays: 4, waivedCents: 400, waivedTaxCents: 28, recordedByUserId: ownerId });
    expect(await getLateReturnWaiverState(ours.jobId)).toEqual({ kind: "WAIVED", waivedCents: 428 });

    // Replaying the waiver is refused and changes no number.
    await expect(recordLateReturnWaiver(ownerId, ours.jobId, { waivedDays: null, note: "Again please" })).rejects.toThrow(/already been waived/);
    expect(await lateInvoice(ours.jobId)).toMatchObject({ subtotalCents: 0, taxCents: 0, amountDueCents: 0 });
    expect(await prisma.lateReturnWaiver.count({ where: { jobId: ours.jobId } })).toBe(1);

    // One day of the four was the company's: a quarter of the charge and of its tax comes off.
    await recordLateReturnWaiver(ownerId, partial.jobId, { waivedDays: 1, note: "One day was ours" });
    expect(await lateInvoice(partial.jobId)).toMatchObject({ subtotalCents: 300, taxCents: 21, amountDueCents: 321, status: "OPEN" });

    // The customer-caused pickup still charges in full, and what the customer owes in total is exactly the sum of the three.
    expect(await lateInvoice(theirs.jobId)).toMatchObject({ subtotalCents: 400, taxCents: 28, amountDueCents: 428, status: "OPEN" });
    const owed = await prisma.invoice.aggregate({ where: { customerId, status: { in: ["OPEN", "DELINQUENT"] } }, _sum: { amountDueCents: true } });
    expect(owed._sum.amountDueCents).toBe(428 + 321);

    // The history shows who did what.
    expect(await prisma.auditLog.count({ where: { action: "billing.late_return_waived", userId: ownerId, entityId: { in: [(await lateInvoice(ours.jobId)).id, (await lateInvoice(partial.jobId)).id] } } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "billing.late_return_waived", entityId: (await lateInvoice(theirs.jobId)).id } })).toBe(0);
  });
});
