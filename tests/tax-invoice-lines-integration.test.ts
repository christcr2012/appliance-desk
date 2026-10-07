import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  computeAgreementInvoiceTax,
  mirrorStripeInvoiceTax,
  recalculateDraftInvoiceTax,
} from "@/domains/tax/invoice-tax";
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
  const stripeTaxRateId = `txr_tax_invoice_${tag}`;

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
    await prisma.taxRateVersion.update({
      where: { id: taxReady.rateVersionId },
      data: { stripeTaxRateId },
    });
  });

  beforeEach(async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: "COLLECT_ON_RENTALS" },
    });
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
          { action: "billing.tax_mismatch" },
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

  it("keeps a tax-blocked late-return bill DRAFT and opens it after recalculation", async () => {
    await prisma.taxJurisdiction.update({
      where: { id: taxReady.jurisdictionId },
      data: { administration: "SELF_COLLECTED" },
    });

    const draft = await makeLateReturnInvoice();

    expect(draft.status).toBe("DRAFT");
    expect(draft.taxCents).toBe(0);
    expect(draft.lineItems.some((line) => line.kind === "TAX")).toBe(false);
    expect(draft.taxLines).toHaveLength(0);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "Invoice",
          entityId: draft.id,
          action: "billing.tax_decision_needed",
        },
      }),
    ).toBe(1);

    await prisma.taxabilityRule.create({
      data: {
        jurisdictionId: taxReady.jurisdictionId,
        category: "LATE_RETURN",
        taxability: "TAXABLE",
        reason: "Synthetic owner decision",
      },
    });

    const recalculated = await prisma.$transaction((tx) =>
      recalculateDraftInvoiceTax(tx, {
        invoiceId: draft.id,
        userId,
      }),
    );
    expect(recalculated.result.ok).toBe(true);

    const opened = await prisma.invoice.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lineItems: true, taxLines: true },
    });
    expect(opened.status).toBe("OPEN");
    expect(opened.taxCents).toBeGreaterThan(0);
    expect(opened.lineItems.filter((line) => line.kind === "TAX")).toHaveLength(1);
    expect(opened.taxLines).toEqual([
      expect.objectContaining({
        jurisdictionId: taxReady.jurisdictionId,
        category: "LATE_RETURN",
        source: "ENGINE",
      }),
    ]);
  });

  it("records Stripe tax and raises exactly one exception for a one-cent mismatch", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        agreementId,
        status: "PAID",
        subtotalCents: 1000,
        taxCents: 11,
        amountDueCents: 1011,
        amountPaidCents: 1011,
      },
    });

    const run = () =>
      prisma.$transaction((tx) =>
        mirrorStripeInvoiceTax(tx, {
          invoiceId: invoice.id,
          agreementId,
          taxDate: new Date(),
          lines: [{ key: "stripe-rent", kind: "RENTAL", amountCents: 1000 }],
          stripeTaxes: [
            {
              taxRateId: stripeTaxRateId,
              amountCents: 11,
              taxableCents: 1000,
            },
          ],
        }),
      );

    const result = await run();
    expect(result).toMatchObject({
      expectedTaxCents: 10,
      stripeTaxCents: 11,
    });
    expect(result.problems.some((problem) => problem.includes("Stripe charged 11 cents"))).toBe(true);
    expect(
      await prisma.invoiceTaxLine.findMany({
        where: { invoiceId: invoice.id, source: "STRIPE" },
      }),
    ).toEqual([
      expect.objectContaining({
        jurisdictionId: taxReady.jurisdictionId,
        rateVersionId: taxReady.rateVersionId,
        taxableCents: 1000,
        taxCents: 11,
      }),
    ]);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "Invoice",
          entityId: invoice.id,
          action: "billing.tax_mismatch",
        },
      }),
    ).toBe(1);

    await run();
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "Invoice",
          entityId: invoice.id,
          action: "billing.tax_mismatch",
        },
      }),
    ).toBe(1);
  });

  it("records exempt engine rows when Stripe correctly charges no tax", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { shortTermLeaseElection: "PAY_ON_ACQUISITION" },
    });
    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        agreementId,
        status: "PAID",
        subtotalCents: 1000,
        taxCents: 0,
        amountDueCents: 1000,
        amountPaidCents: 1000,
      },
    });

    const result = await prisma.$transaction((tx) =>
      mirrorStripeInvoiceTax(tx, {
        invoiceId: invoice.id,
        agreementId,
        taxDate: new Date(),
        lines: [{ key: "stripe-rent", kind: "RENTAL", amountCents: 1000 }],
        stripeTaxes: [],
      }),
    );

    expect(result.problems).toEqual([]);
    expect(
      await prisma.invoiceTaxLine.findMany({ where: { invoiceId: invoice.id } }),
    ).toEqual([
      expect.objectContaining({
        source: "ENGINE",
        jurisdictionId: taxReady.jurisdictionId,
        taxableCents: 0,
        exemptCents: 1000,
        taxCents: 0,
      }),
    ]);
  });

  it("does not treat account credit as a taxable-base reduction", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        customerId,
        agreementId,
        status: "PAID",
        subtotalCents: 500,
        taxCents: 10,
        amountDueCents: 510,
        amountPaidCents: 510,
      },
    });

    const result = await prisma.$transaction((tx) =>
      mirrorStripeInvoiceTax(tx, {
        invoiceId: invoice.id,
        agreementId,
        taxDate: new Date(),
        lines: [
          { key: "stripe-rent", kind: "RENTAL", amountCents: 1000 },
          { key: "account-credit", kind: "CREDIT", amountCents: -500 },
        ],
        stripeTaxes: [
          {
            taxRateId: stripeTaxRateId,
            amountCents: 10,
            taxableCents: 1000,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      expectedTaxCents: 10,
      stripeTaxCents: 10,
      problems: [],
    });
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "Invoice",
          entityId: invoice.id,
          action: "billing.tax_mismatch",
        },
      }),
    ).toBe(0);
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
