import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { businessDateEnd, businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { recordLateReturnOnRemoval } from "@/domains/billing/pickup-billing-events";
import { recordLateReturnWaiverInTx } from "@/domains/billing/late-return-waiver";
import { recalculateLocalInvoiceTax } from "@/domains/tax/local-invoice";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T local invoice tax evidence (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `tax-invoice-owner-${tag}`;
  const customerUserId = `tax-invoice-user-${tag}`;
  const customerId = `tax-invoice-customer-${tag}`;
  const addressId = `tax-invoice-address-${tag}`;
  const typeId = `tax-invoice-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  async function lateReturnFixture(index: number) {
    const agreementId = `tax-invoice-agreement-${index}-${tag}`;
    const applianceId = `tax-invoice-appliance-${index}-${tag}`;
    const jobId = `tax-invoice-job-${index}-${tag}`;
    agreementIds.push(agreementId);
    applianceIds.push(applianceId);
    jobIds.push(jobId);

    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ENDED",
        termMonths: 12,
        endDate: businessDateEnd("2026-10-10"),
        billingStartedAt: businessDateFromKey("2025-10-10"),
        paidInFullInAdvance: false,
        taxRateMilliPercent: 9999, // deliberately wrong: Batch T must not use this for arithmetic.
        lines: {
          create: {
            label: "Washer",
            monthlyPriceCents: 4_500,
            listPriceCents: 4_500,
          },
        },
      },
    });
    const rentalLine = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    await prisma.appliance.create({
      data: {
        id: applianceId,
        assetNumber: `TI-${index}-${tag.slice(0, 8)}`,
        applianceTypeId: typeId,
        status: "RENTED",
      },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: rentalLine.id, applianceId },
    });
    await prisma.job.create({
      data: {
        id: jobId,
        type: "REMOVAL",
        status: "COMPLETED",
        customerId,
        serviceAddressId: addressId,
        agreementId,
      },
    });

    return { agreementId, applianceId, jobId };
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${tag}-owner@example.test`,
          name: "Tax Invoice Owner",
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: customerUserId,
          email: `${tag}-customer@example.test`,
          name: "Tax Invoice Customer",
          role: "CUSTOMER",
          emailVerified: true,
        },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId: customerUserId, referralCode: `TI${tag.slice(0, 16)}` },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "100 Test Ave", city: "Greeley", zip: "80631" },
    });
    await prisma.applianceType.create({
      data: { id: typeId, name: `Tax Invoice ${tag}`, slug: `tax-invoice-${tag}` },
    });
    taxFixture = await seedTaxReadyContext(addressId, { rateMilliPercent: 7_500 });
  });

  afterAll(async () => {
    const invoices = (
      await prisma.invoice.findMany({
        where: { agreementId: { in: agreementIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.lateReturnWaiver.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: invoices } },
          { entityId: { in: agreementIds } },
          { entityId: { in: jobIds } },
        ],
      },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoices } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await taxFixture.cleanup();
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  it("stores address-exact late-return tax by jurisdiction and ignores the old agreement rate", async () => {
    const fixture = await lateReturnFixture(1);
    const result = await prisma.$transaction((tx) =>
      recordLateReturnOnRemoval(tx, {
        userId: ownerId,
        jobId: fixture.jobId,
        agreementId: fixture.agreementId,
        applianceIds: [fixture.applianceId],
        pickupDate: businessDateFromKey("2026-10-14")!,
      }),
    );

    expect(result.lateReturnInvoiceId).not.toBeNull();
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.lateReturnInvoiceId! },
      include: { lineItems: true, taxLines: true },
    });
    expect(invoice.status).toBe("OPEN");
    expect(invoice.subtotalCents).toBe(450);
    expect(invoice.taxCents).toBe(34); // 7.5% of $4.50, not the 9.999% agreement snapshot.
    expect(invoice.amountDueCents).toBe(484);
    expect(invoice.lineItems.filter((line) => line.kind === "TAX")).toHaveLength(1);
    expect(invoice.taxLines).toEqual([
      expect.objectContaining({
        jurisdictionId: taxFixture.jurisdictionId,
        rateVersionId: taxFixture.rateVersionId,
        category: "LATE_RETURN",
        taxableCents: 450,
        exemptCents: 0,
        taxCents: 34,
        source: "ENGINE",
      }),
    ]);
  });

  it("reverses a partial waiver against the same stored jurisdiction and rate", async () => {
    const fixture = await lateReturnFixture(2);
    const billed = await prisma.$transaction((tx) =>
      recordLateReturnOnRemoval(tx, {
        userId: ownerId,
        jobId: fixture.jobId,
        agreementId: fixture.agreementId,
        applianceIds: [fixture.applianceId],
        pickupDate: businessDateFromKey("2026-10-14")!,
      }),
    );

    const waiver = await prisma.$transaction((tx) =>
      recordLateReturnWaiverInTx(
        tx,
        { userId: ownerId },
        { jobId: fixture.jobId, waivedDays: 1, note: "Our truck was delayed." },
      ),
    );
    expect(waiver.waivedCents).toBe(150);
    expect(waiver.waivedTaxCents).toBe(11);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: billed.lateReturnInvoiceId! },
      include: { taxLines: { orderBy: { createdAt: "asc" } } },
    });
    expect(invoice.subtotalCents).toBe(300);
    expect(invoice.taxCents).toBe(23);
    expect(invoice.amountDueCents).toBe(323);
    expect(invoice.taxLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jurisdictionId: taxFixture.jurisdictionId,
          rateVersionId: taxFixture.rateVersionId,
          taxableCents: 450,
          taxCents: 34,
        }),
        expect.objectContaining({
          jurisdictionId: taxFixture.jurisdictionId,
          rateVersionId: taxFixture.rateVersionId,
          taxableCents: -150,
          taxCents: -11,
        }),
      ]),
    );
  });

  it("keeps the field operation successful when tax is undecided, then opens the draft after recalculation", async () => {
    const fixture = await lateReturnFixture(3);
    await prisma.taxabilityRule.update({
      where: {
        jurisdictionId_category: {
          jurisdictionId: taxFixture.jurisdictionId,
          category: "LATE_RETURN",
        },
      },
      data: { taxability: "UNDECIDED" },
    });

    const billed = await prisma.$transaction((tx) =>
      recordLateReturnOnRemoval(tx, {
        userId: ownerId,
        jobId: fixture.jobId,
        agreementId: fixture.agreementId,
        applianceIds: [fixture.applianceId],
        pickupDate: businessDateFromKey("2026-10-14")!,
      }),
    );
    const blocked = await prisma.invoice.findUniqueOrThrow({
      where: { id: billed.lateReturnInvoiceId! },
      include: { taxLines: true },
    });
    expect(blocked.status).toBe("DRAFT");
    expect(blocked.taxCents).toBe(0);
    expect(blocked.taxLines).toHaveLength(0);
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "billing.invoice_tax_blocked",
        entityType: "Invoice",
        entityId: blocked.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect((audit?.newValue as { problems?: string[] } | null)?.problems?.join(" ")).toMatch(/not decided/i);

    await prisma.taxabilityRule.update({
      where: {
        jurisdictionId_category: {
          jurisdictionId: taxFixture.jurisdictionId,
          category: "LATE_RETURN",
        },
      },
      data: { taxability: "TAXABLE" },
    });
    expect(await recalculateLocalInvoiceTax(ownerId, blocked.id)).toEqual({
      ok: true,
      totalTaxCents: 34,
    });

    const recovered = await prisma.invoice.findUniqueOrThrow({
      where: { id: blocked.id },
      include: { taxLines: true },
    });
    expect(recovered.status).toBe("OPEN");
    expect(recovered.taxCents).toBe(34);
    expect(recovered.amountDueCents).toBe(484);
    expect(recovered.taxLines).toHaveLength(1);
  });
});
