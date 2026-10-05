import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));

import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { businessDateFromKey } from "@/lib/business-date";
import { openCustodyEpisodeInTx } from "@/domains/inventory/custody";
import { recordLateReturnWaiver, lateReturnWaiverCents } from "@/domains/billing/late-return-waiver";
import { closeFullyReturnedAgreements } from "@/domains/agreements/returns";
import { agreedEndFor } from "@/domains/billing/pickup-billing-events";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe("late-return waiver cents (pure)", () => {
  it("waives everything when all days are waived, else rounds half up", () => {
    expect(lateReturnWaiverCents({ days: 4, amountCents: 400 }, 4)).toBe(400);
    expect(lateReturnWaiverCents({ days: 4, amountCents: 400 }, 9)).toBe(400);
    expect(lateReturnWaiverCents({ days: 4, amountCents: 400 }, 1)).toBe(100);
    expect(lateReturnWaiverCents({ days: 3, amountCents: 100 }, 1)).toBe(33);
    expect(lateReturnWaiverCents({ days: 2, amountCents: 101 }, 1)).toBe(51);
  });
  it("the agreed end is the earlier of the term end and the second before an agreed ending", () => {
    const termEnd = new Date("2027-03-01T06:59:59Z");
    const effective = new Date("2025-09-01T06:00:00Z");
    expect(agreedEndFor({ endDate: termEnd, terminationEffectiveOn: effective })?.toISOString()).toBe("2025-09-01T05:59:59.000Z");
    expect(agreedEndFor({ endDate: null, terminationEffectiveOn: effective })?.toISOString()).toBe("2025-09-01T05:59:59.000Z");
    expect(agreedEndFor({ endDate: termEnd })?.toISOString()).toBe(termEnd.toISOString());
    expect(agreedEndFor({ endDate: null })).toBeNull();
  });
});

describe.skipIf(!enabled)("pickup billing end: late returns, waiver and closing after full return", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `pb-owner-${tag}`;
  const staffId = `pb-staff-${tag}`;
  const userId = `pb-user-${tag}`;
  const customerId = `pb-customer-${tag}`;
  const addressId = `pb-address-${tag}`;
  const typeId = `pb-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const octEnd = new Date("2025-11-01T05:59:59Z"); // the end of Colorado's October 31, 2025

  async function rental(opts: { endDate?: Date | null; termMonths?: number | null; terminationEffectiveOn?: Date; units?: number } = {}) {
    const agreementId = `pb-ag-${agreementIds.length}-${tag}`;
    agreementIds.push(agreementId);
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: opts.termMonths === undefined ? 12 : opts.termMonths,
        endDate: opts.endDate === undefined ? octEnd : opts.endDate,
        terminationEffectiveOn: opts.terminationEffectiveOn ?? null,
        terminationRequestedAt: opts.terminationEffectiveOn ? new Date("2025-08-01T06:00:00Z") : null,
        terminationFeeCents: opts.terminationEffectiveOn ? 0 : null,
        taxRateMilliPercent: 7000,
        firstDeliveredOn: new Date("2024-11-01T06:00:00Z"),
        lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } },
      },
    });
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    const units: string[] = [];
    const setupId = `pb-setup-${jobIds.length}-${tag}`;
    jobIds.push(setupId);
    await prisma.job.create({ data: { id: setupId, type: "DELIVERY", status: "COMPLETED", customerId, serviceAddressId: addressId, agreementId } });
    for (let i = 0; i < (opts.units ?? 1); i += 1) {
      const id = `pb-unit-${applianceIds.length}-${tag}`;
      applianceIds.push(id);
      await prisma.appliance.create({ data: { id, assetNumber: `PB${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status: "RENTED" } });
      await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: id } });
      await prisma.$transaction((tx) =>
        openCustodyEpisodeInTx(tx, { applianceId: id, customerId, serviceAddressId: addressId, agreementId, startedOn: new Date("2024-11-01T06:00:00Z"), startJobId: setupId }),
      );
      units.push(id);
    }
    return { agreementId, units };
  }

  async function pickup(agreementId: string, units: string[], on: string) {
    const id = `pb-job-${jobIds.length}-${tag}`;
    jobIds.push(id);
    await prisma.job.create({
      data: { id, type: "REMOVAL", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId, appliances: { create: units.map((applianceId) => ({ applianceId })) } },
    });
    await completeJob(ownerId, {
      jobId: id,
      expectedVersion: 1,
      completionKey: `pb-key-${randomUUID()}`,
      performedOn: businessDateFromKey(on),
      completionNotes: null,
      results: units.map((applianceId) => ({ applianceId, result: "RETURNED" as const })),
    });
    return id;
  }

  const agreementOf = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });
  const lateInvoice = async (jobId: string) => {
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "billing.late_return_invoiced", newValue: { path: ["jobId"], equals: jobId } } });
    return prisma.invoice.findUniqueOrThrow({ where: { id: audit.entityId! }, include: { lineItems: true } });
  };

  beforeEach(() => undefined);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "PB Owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `${tag}-s@example.test`, name: "PB Staff", role: "STAFF", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "PB Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `P${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.create({ data: { id: typeId, name: `PB ${tag}`, slug: `pb-${tag}` } });
  });

  afterAll(async () => {
    const invoices = (await prisma.invoice.findMany({ where: { customerId }, select: { id: true } })).map((i) => i.id);
    await prisma.lateReturnWaiver.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoices } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: { in: [ownerId, staffId] } }, { entityId: { in: [...invoices, ...agreementIds, ...jobIds, ...applianceIds] } }] },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.updateMany({ where: { id: { in: agreementIds } }, data: { renewedFromAgreementId: null } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, userId] } } });
  });

  it("late-by-customer-bills-daily-unchanged, and full-return-after-term-end-closes-agreement-on-term-end", async () => {
    const { agreementId, units } = await rental();
    const job = await pickup(agreementId, units, "2025-11-05");
    const invoice = await lateInvoice(job);
    expect(invoice.subtotalCents).toBe(400); // Nov 1 to Nov 4: 4 days of $30 / 30
    expect(invoice.taxCents).toBe(28);
    expect(invoice.amountDueCents).toBe(428);
    const after = await agreementOf(agreementId);
    expect(after.status).toBe("ENDED");
    expect(after.endDate?.toISOString()).toBe(octEnd.toISOString());
  });

  it("late-by-company-waives-all-days-invoice-zero-paid", async () => {
    const { agreementId, units } = await rental();
    const job = await pickup(agreementId, units, "2025-11-05");
    await recordLateReturnWaiver(ownerId, job, { waivedDays: null, note: "Our truck was late" });
    const invoice = await lateInvoice(job);
    expect(invoice.amountDueCents).toBe(0);
    expect(invoice.subtotalCents).toBe(0);
    expect(invoice.taxCents).toBe(0);
    expect(invoice.status).toBe("PAID");
    expect(invoice.lineItems.filter((l) => l.kind === "LATE_RETURN")).toHaveLength(1); // the original stays visible
    expect(invoice.lineItems.filter((l) => l.kind === "LATE_RETURN_WAIVER").map((l) => l.amountCents)).toEqual([-400]);
    expect(invoice.lineItems.filter((l) => l.kind === "TAX").map((l) => l.amountCents).sort((a, b) => a - b)).toEqual([-28, 28]);
  });

  it("late-by-company-partial-days", async () => {
    const { agreementId, units } = await rental();
    const job = await pickup(agreementId, units, "2025-11-05");
    await recordLateReturnWaiver(ownerId, job, { waivedDays: 1, note: "One day was ours" });
    const invoice = await lateInvoice(job);
    expect(invoice.subtotalCents).toBe(300);
    expect(invoice.taxCents).toBe(21);
    expect(invoice.amountDueCents).toBe(321);
    expect(invoice.status).toBe("OPEN");
    const waiver = await prisma.lateReturnWaiver.findUniqueOrThrow({ where: { jobId: job } });
    expect([waiver.waivedCents, waiver.waivedTaxCents, waiver.waivedDays]).toEqual([100, 7, 1]);
  });

  it("waiver-refused-for-staff, waiver-twice-refused, waiver-refused-after-payment", async () => {
    const a = await rental();
    const jobA = await pickup(a.agreementId, a.units, "2025-11-05");
    await expect(recordLateReturnWaiver(staffId, jobA, { waivedDays: null, note: "Staff try" })).rejects.toThrow();
    await recordLateReturnWaiver(ownerId, jobA, { waivedDays: 1, note: "One day was ours" });
    await expect(recordLateReturnWaiver(ownerId, jobA, { waivedDays: 1, note: "Again please" })).rejects.toThrow(/already been waived/);

    const b = await rental();
    const jobB = await pickup(b.agreementId, b.units, "2025-11-05");
    const invoice = await lateInvoice(jobB);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { amountPaidCents: 100, status: "PARTIALLY_PAID" } });
    await expect(recordLateReturnWaiver(ownerId, jobB, { waivedDays: null, note: "Too late for this" })).rejects.toThrow(/no longer open|payment/i);
  });

  it("early-ending-pickup-after-effective-date-charged-from-effective-date (the A6 fix)", async () => {
    const { agreementId, units } = await rental({ endDate: new Date("2027-03-01T06:59:59Z"), terminationEffectiveOn: new Date("2025-09-01T06:00:00Z") });
    const job = await pickup(agreementId, units, "2025-09-05");
    const invoice = await lateInvoice(job);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "billing.late_return_invoiced", entityId: invoice.id } });
    expect((audit.newValue as { items: Array<{ firstChargedDay: string; days: number }> }).items[0]).toMatchObject({ firstChargedDay: "2025-09-01", days: 4 });
    expect((await agreementOf(agreementId)).status).toBe("ENDED");
  });

  it("full-return-before-agreed-end-is-early-return and month-to-month-without-ending-is-early-return: stays open for the owner's choice", async () => {
    const fixed = await rental({ endDate: new Date("2027-03-01T06:59:59Z") });
    const jobFixed = await pickup(fixed.agreementId, fixed.units, "2025-11-05");
    expect((await agreementOf(fixed.agreementId)).status).toBe("ACTIVE");
    expect(await prisma.auditLog.count({ where: { action: "billing.late_return_invoiced", newValue: { path: ["jobId"], equals: jobFixed } } })).toBe(0);
    const monthly = await rental({ termMonths: null, endDate: null });
    await pickup(monthly.agreementId, monthly.units, "2025-11-05");
    expect((await agreementOf(monthly.agreementId)).status).toBe("ACTIVE");
  });

  it("partial-return-leaves-agreement-open", async () => {
    const { agreementId, units } = await rental({ units: 2 });
    await pickup(agreementId, [units[0]!], "2025-11-05");
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE");
  });

  it("dst: pickup the day before the clocks change owes nothing late; on the change day owes exactly one day; both close", async () => {
    const early = await rental();
    const jobEarly = await pickup(early.agreementId, early.units, "2025-11-01");
    expect(await prisma.auditLog.count({ where: { action: "billing.late_return_invoiced", newValue: { path: ["jobId"], equals: jobEarly } } })).toBe(0);
    expect((await agreementOf(early.agreementId)).status).toBe("ENDED");
    const change = await rental();
    const jobChange = await pickup(change.agreementId, change.units, "2025-11-02");
    const invoice = await lateInvoice(jobChange);
    expect([invoice.subtotalCents, invoice.taxCents]).toEqual([100, 7]);
    expect((await agreementOf(change.agreementId)).status).toBe("ENDED");
  });

  it("a signed renewal waiting makes a high task instead of closing", async () => {
    const { agreementId, units } = await rental();
    const renewalId = `pb-renewal-${tag}`;
    agreementIds.push(renewalId);
    await prisma.rentalAgreement.create({
      data: { id: renewalId, customerId, serviceAddressId: addressId, status: "SCHEDULED", termMonths: null, renewedFromAgreementId: agreementId, startDate: new Date("2025-11-01T06:00:00Z") },
    });
    const job = await pickup(agreementId, units, "2025-11-05");
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE");
    const task = await prisma.staffTask.findFirst({ where: { sourceKey: `job:${job}:returned-renewal-waiting` } });
    expect(task?.priority).toBe("HIGH");
  });

  it("the nightly pass closes a fully returned rental once its agreed end has arrived", async () => {
    const { agreementId, units } = await rental({ endDate: new Date("2027-03-01T06:59:59Z") });
    await pickup(agreementId, units, "2025-11-05");
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE");
    await closeFullyReturnedAgreements(new Date("2027-02-01T12:00:00Z")); // other rentals in a shared test database may close; this one must not
    expect((await agreementOf(agreementId)).status).toBe("ACTIVE");
    const result = await closeFullyReturnedAgreements(new Date("2027-03-02T12:00:00Z"));
    expect(result.closed).toBeGreaterThanOrEqual(1);
    const after = await agreementOf(agreementId);
    expect(after.status).toBe("ENDED");
    expect(after.endDate?.toISOString()).toBe("2027-03-01T06:59:59.000Z");
  });
});
