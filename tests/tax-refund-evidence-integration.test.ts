import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  billedRentalLineEvidenceInTx,
  historicalRentalTaxForBaseCentsInTx,
} from "@/domains/billing/refund-across-invoices";
import { prisma } from "@/lib/prisma";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T historical refund tax evidence (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `refund-tax-user-${tag}`;
  const customerId = `refund-tax-customer-${tag}`;
  const addressId = `refund-tax-address-${tag}`;
  const agreementId = `refund-tax-agreement-${tag}`;
  const rentalLineId = `refund-tax-line-${tag}`;
  const newerRateId = `refund-tax-rate-new-${tag}`;
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${tag}-refund-tax@example.test`,
        name: "Refund Tax Customer",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `RT${tag.slice(0, 16)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "7300 Evidence Ave",
        city: "Greeley",
        zip: "80631",
      },
    });
    taxFixture = await seedTaxReadyContext(addressId, { rateMilliPercent: 7_300 });
    await prisma.taxRateVersion.create({
      data: {
        id: newerRateId,
        jurisdictionId: taxFixture.jurisdictionId,
        rateMilliPercent: 8_000,
        effectiveFrom: new Date("2026-02-01T07:00:00.000Z"),
        source: "MANUAL",
      },
    });

    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
      },
    });
    await prisma.rentalLine.create({
      data: {
        id: rentalLineId,
        agreementId,
        label: "Washer",
        listPriceCents: 4_000,
        monthlyPriceCents: 4_000,
      },
    });

    for (const period of [
      {
        suffix: "old",
        start: new Date("2026-01-01T07:00:00.000Z"),
        taxCents: 292,
        rateVersionId: taxFixture.rateVersionId,
      },
      {
        suffix: "new",
        start: new Date("2026-02-01T07:00:00.000Z"),
        taxCents: 320,
        rateVersionId: newerRateId,
      },
    ]) {
      const invoice = await prisma.invoice.create({
        data: {
          id: `refund-tax-invoice-${period.suffix}-${tag}`,
          customerId,
          agreementId,
          status: "PAID",
          billingPeriodStart: period.start,
          subtotalCents: 4_000,
          taxCents: period.taxCents,
          amountDueCents: 4_000 + period.taxCents,
          amountPaidCents: 4_000 + period.taxCents,
        },
      });
      const line = await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          kind: "RENTAL",
          description: "Washer",
          amountCents: 4_000,
          rentalLineId,
        },
      });
      await prisma.invoiceTaxLine.create({
        data: {
          invoiceId: invoice.id,
          invoiceLineItemId: line.id,
          jurisdictionId: taxFixture.jurisdictionId,
          rateVersionId: period.rateVersionId,
          category: "RENTAL",
          taxableCents: 4_000,
          taxCents: period.taxCents,
          source: "STRIPE",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { agreementId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reads the actual billed base and tax instead of an agreement-rate reconstruction", async () => {
    const evidence = await prisma.$transaction((tx) =>
      billedRentalLineEvidenceInTx(tx, { agreementId, rentalLineId }),
    );

    expect(evidence).toEqual({
      baseCents: 8_000,
      taxCents: 612,
      totalCents: 8_612,
      evidenceComplete: true,
    });
  });

  it("reverses tax from the newest billed rental evidence first when rates changed", async () => {
    const halfNewest = await prisma.$transaction((tx) =>
      historicalRentalTaxForBaseCentsInTx(tx, {
        agreementId,
        baseCents: 2_000,
      }),
    );
    expect(halfNewest).toEqual({
      taxCents: 160,
      uncoveredBaseCents: 0,
      evidenceComplete: true,
    });

    const newestPlusHalfOlder = await prisma.$transaction((tx) =>
      historicalRentalTaxForBaseCentsInTx(tx, {
        agreementId,
        baseCents: 6_000,
      }),
    );
    expect(newestPlusHalfOlder).toEqual({
      taxCents: 466,
      uncoveredBaseCents: 0,
      evidenceComplete: true,
    });
  });

  it("flags a legacy taxed invoice with no line-level tax evidence instead of treating its tax as zero", async () => {
    const legacyInvoiceId = `refund-tax-invoice-legacy-${tag}`;
    const invoice = await prisma.invoice.create({
      data: {
        id: legacyInvoiceId,
        customerId,
        agreementId,
        status: "PAID",
        billingPeriodStart: new Date("2026-03-01T07:00:00.000Z"),
        subtotalCents: 4_000,
        taxCents: 400,
        amountDueCents: 4_400,
        amountPaidCents: 4_400,
      },
    });
    await prisma.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        kind: "RENTAL",
        description: "Washer",
        amountCents: 4_000,
        rentalLineId,
      },
    });

    try {
      const lineEvidence = await prisma.$transaction((tx) =>
        billedRentalLineEvidenceInTx(tx, { agreementId, rentalLineId }),
      );
      expect(lineEvidence.evidenceComplete).toBe(false);

      const newest = await prisma.$transaction((tx) =>
        historicalRentalTaxForBaseCentsInTx(tx, {
          agreementId,
          baseCents: 1_000,
        }),
      );
      expect(newest).toEqual({
        taxCents: 0,
        uncoveredBaseCents: 0,
        evidenceComplete: false,
      });
    } finally {
      await prisma.invoice.delete({ where: { id: legacyInvoiceId } });
    }
  });

});
