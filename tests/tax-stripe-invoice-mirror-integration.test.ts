import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { recordStripeInvoiceTaxEvidenceInTx } from "@/domains/tax/stripe-invoice-mirror";
import { prisma } from "@/lib/prisma";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T Stripe tax mirror mismatch (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `stripe-tax-user-${tag}`;
  const customerId = `stripe-tax-customer-${tag}`;
  const addressId = `stripe-tax-address-${tag}`;
  const agreementId = `stripe-tax-agreement-${tag}`;
  const invoiceId = `stripe-tax-invoice-${tag}`;
  const stripeTaxRateId = `txr_stripe_tax_${tag}`;
  let invoiceLineItemId: string;
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${tag}-stripe-tax@example.test`,
        name: "Stripe Tax Customer",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `ST${tag.slice(0, 16)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "291 Synthetic Ave",
        city: "Greeley",
        zip: "80631",
      },
    });
    taxFixture = await seedTaxReadyContext(addressId, { rateMilliPercent: 7_300 });
    await prisma.taxRateVersion.update({
      where: { id: taxFixture.rateVersionId },
      data: { stripeTaxRateId },
    });

    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        taxRateMilliPercent: 7_300,
      },
    });
    const rentalLine = await prisma.rentalLine.create({
      data: {
        agreementId,
        label: "Washer",
        listPriceCents: 4_000,
        monthlyPriceCents: 4_000,
      },
    });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        customerId,
        agreementId,
        status: "OPEN",
        subtotalCents: 4_000,
        taxCents: 291,
        amountDueCents: 4_291,
        stripeInvoiceId: `in_${tag}`,
      },
    });
    const invoiceLine = await prisma.invoiceLineItem.create({
      data: {
        invoiceId,
        kind: "RENTAL",
        description: "Washer",
        amountCents: 4_000,
        rentalLineId: rentalLine.id,
      },
    });
    invoiceLineItemId = invoiceLine.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores Stripe as the tax authority, records a one-cent mismatch, and stays idempotent", async () => {
    const stripeLine = {
      id: `il_${tag}`,
      description: "Washer",
      amount: 4_000,
      taxes: [
        {
          amount: 291,
          taxable_amount: 4_000,
          tax_rate_details: { tax_rate: stripeTaxRateId },
        },
      ],
    } as unknown as Stripe.InvoiceLineItem;
    const stripeInvoice = {
      id: `in_${tag}`,
      created: 1_767_153_600,
      period_start: 1_767_153_600,
      lines: { data: [stripeLine] },
    } as unknown as Stripe.Invoice;

    const run = () =>
      prisma.$transaction((tx) =>
        recordStripeInvoiceTaxEvidenceInTx(tx, {
          invoiceId,
          agreementId,
          stripeInvoice,
          chargeLines: [
            {
              stripeLine,
              invoiceLineItemId,
              kind: "RENTAL",
              amountCents: 4_000,
            },
          ],
        }),
      );

    await run();

    const taxLines = await prisma.invoiceTaxLine.findMany({ where: { invoiceId } });
    expect(taxLines).toEqual([
      expect.objectContaining({
        invoiceLineItemId,
        jurisdictionId: taxFixture.jurisdictionId,
        rateVersionId: taxFixture.rateVersionId,
        category: "RENTAL",
        taxableCents: 4_000,
        taxCents: 291,
        source: "STRIPE",
      }),
    ]);

    const mismatch = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "billing.stripe_tax_mismatch",
        entityType: "Invoice",
        entityId: invoiceId,
      },
    });
    expect(mismatch.newValue).toEqual(
      expect.objectContaining({
        stripeTaxCents: 291,
        engineTaxCents: 292,
      }),
    );

    await run();

    expect(await prisma.invoiceTaxLine.count({ where: { invoiceId } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "billing.stripe_tax_mismatch",
          entityType: "Invoice",
          entityId: invoiceId,
        },
      }),
    ).toBe(1);
  });
});
