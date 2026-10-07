import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { computeAgreementInvoiceTax } from "@/domains/tax/invoice-tax";
import { recordLateReturnOnRemoval } from "@/domains/billing/pickup-billing-events";
import { businessDateEnd, businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T invoice tax lines (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `tax-invoice-user-${tag}`;
  const customerId = `tax-invoice-customer-${tag}`;
  const addressId = `tax-invoice-address-${tag}`;
  const agreementId = `tax-invoice-agreement-${tag}`;
  const typeId = `tax-invoice-type-${tag}`;
  const applianceId = `tax-invoice-unit-${tag}`;
  let rentalLineId: string;
  let taxReady: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `TI${tag.slice(0, 10)}` },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Synthetic Invoice Tax Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 6,
        endDate: businessDateEnd("2026-10-10"),
        billingStartedAt: businessDateFromKey("2026-04-10"),
      },
    });
    const rentalLine = await prisma.rentalLine.create({
      data: {
        agreementId,
        label: "Washer",
        monthlyPriceCents: 3000,
        listPriceCents: 3000,
      },
    });
    rentalLineId = rentalLine.id;
    await prisma.applianceType.create({
      data: { id: typeId, name: `Tax Invoice ${tag}`, slug: `tax-invoice-${tag}` },
    });
    await prisma.appliance.create({
      data: {
        id: applianceId,
        assetNumber: `TI-${tag.slice(0, 10)}`,
        applianceTypeId: typeId,
        status: "RENTED",
      },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId, applianceId },
    });
    taxReady = await seedTaxReadyContext(addressId, { rateMilliPercent: 1000 });
  });

  beforeEach(async () => {
    await prisma.addressTaxLocation.updateMany({
      where: { serviceAddressId: addressId, isCurrent: true },
      data: { status: "VERIFIED" },
    });
    await prisma.taxJurisdiction.update({
      where: { id: taxReady.jurisdictionId },
      data: { administration: "STATE_COLLECTED", reviewStatus: "REVIEWED" },
    });
    await prisma.taxabilityRule.deleteMany({
      where: {
        jurisdictionId: taxReady.jurisdictionId,
        category: "LATE_RETURN",
      },
    });
    await prisma.invoice.deleteMany({ where: { agreementId } });
    await prisma.auditLog.deleteMany({
      where: {
        entityType: "Invoice",
        OR: [
          { action: "billing.late_return_invoiced" },
          { action: "billing.tax_decision_needed" },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { agreementId } });
    await prisma.auditLog.deleteMany({
      where: {
        entityType: "Invoice",
        OR: [
          { action: "billing.late_return_invoiced" },
          { action: "billing.tax_decision_needed" },
        ],
      },
    });
    await taxReady.cleanup();
    await prisma.applianceAssignment.deleteMany({ where: { applianceId } });
    await prisma.appliance.deleteMany({ where: { id: applianceId } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.rentalLine.deleteMany({ where: { id: rentalLineId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("calculates each local invoice line through the jurisdiction engine", async () => {
    const result = await prisma.$transaction((tx) =>
      computeAgreementInvoiceTax(tx, {
        agreementId,
        taxDate: new Date(),
        lines: [
          {
            key: "late-1",
            kind: "LATE_RETURN",
            amountCents: 1000,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      totalTaxCents: 10,
      lines: [
        {
          lineKey: "late-1",
          jurisdictionId: taxReady.jurisdictionId,
          rateVersionId: taxReady.rateVersionId,
          category: "LATE_RETURN",
          taxableCents: 1000,
          taxCents: 10,
        },
      ],
    });
  });

  async function makeLateReturnInvoice() {
    await prisma.$transaction((tx) =>
      recordLateReturnOnRemoval(tx, {
        userId,
        jobId: `tax-invoice-job-${tag}`,
        agreementId,
        applianceIds: [applianceId],
        pickupDate: businessDateFromKey("2026-10-14")!,
      }),
    );
    return prisma.invoice.findFirstOrThrow({
      where: { agreementId },
      orderBy: { createdAt: "desc" },
      include: { lineItems: true, taxLines: true },
    });
  }

  it("taxes late return rent when the business elected to collect on rentals", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: "COLLECT_ON_RENTALS" },
    });

    const invoice = await makeLateReturnInvoice();

    expect(invoice.status).toBe("OPEN");
    expect(invoice.taxCents).toBeGreaterThan(0);
    expect(invoice.taxLines).toEqual([
      expect.objectContaining({
        jurisdictionId: taxReady.jurisdictionId,
        rateVersionId: taxReady.rateVersionId,
        category: "LATE_RETURN",
        taxableCents: expect.any(Number),
        exemptCents: 0,
        taxCents: expect.any(Number),
        source: "ENGINE",
      }),
    ]);
  });

  it("records an exempt late return row under the pay-on-acquisition election", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: "PAY_ON_ACQUISITION" },
    });

    const invoice = await makeLateReturnInvoice();

    expect(invoice.status).toBe("OPEN");
    expect(invoice.taxCents).toBe(0);
    expect(invoice.taxLines).toEqual([
      expect.objectContaining({
        jurisdictionId: taxReady.jurisdictionId,
        category: "LATE_RETURN",
        taxableCents: 0,
        exemptCents: expect.any(Number),
        exemptReason: expect.stringMatching(/tax paid when the appliance was bought/i),
        taxCents: 0,
        source: "ENGINE",
      }),
    ]);
  });

  it("returns a problem instead of throwing when the address needs review", async () => {
    await prisma.addressTaxLocation.updateMany({
      where: { serviceAddressId: addressId, isCurrent: true },
      data: { status: "NEEDS_REVIEW" },
    });

    const result = await prisma.$transaction((tx) =>
      computeAgreementInvoiceTax(tx, {
        agreementId,
        taxDate: new Date(),
        lines: [{ key: "late-1", kind: "LATE_RETURN", amountCents: 1000 }],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toContain(
        "Confirm the tax areas for this service address before sending this bill.",
      );
    }
  });
});
