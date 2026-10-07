import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrepaidRentInvoiceInTx } from "@/domains/tax/prepaid-invoice";
import { prisma } from "@/lib/prisma";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch T prepaid rent invoice (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const customerUserId = `tax-prepaid-user-${tag}`;
  const customerId = `tax-prepaid-customer-${tag}`;
  const addressId = `tax-prepaid-address-${tag}`;
  const agreementId = `tax-prepaid-agreement-${tag}`;
  const signedAt = new Date("2026-10-07T18:00:00.000Z");
  let taxFixture: Awaited<ReturnType<typeof seedTaxReadyContext>>;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: customerUserId,
        email: `${tag}-prepaid@example.test`,
        name: "Prepaid Tax Customer",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId: customerUserId,
        referralCode: `TP${tag.slice(0, 16)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "200 Synthetic Ave",
        city: "Greeley",
        zip: "80631",
      },
    });
    taxFixture = await seedTaxReadyContext(addressId, { rateMilliPercent: 7_500 });

    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 12,
        paidInFullInAdvance: true,
        freeMonthGranted: true,
        taxRateMilliPercent: 9_999,
        lines: {
          create: {
            label: "Washer",
            listPriceCents: 4_500,
            prepayDiscountCentsPerMonth: 500,
            monthlyPriceCents: 4_000,
          },
        },
      },
    });
  });

  afterAll(async () => {
    const invoiceIds = (
      await prisma.invoice.findMany({
        where: { agreementId },
        select: { id: true },
      })
    ).map((invoice) => invoice.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: invoiceIds } },
          { entityId: agreementId },
        ],
      },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await taxFixture.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: customerUserId } });
  });

  it("creates one full-term local invoice using the discounted rent, free month, and address tax engine", async () => {
    const first = await prisma.$transaction((tx) =>
      createPrepaidRentInvoiceInTx(tx, agreementId, signedAt),
    );

    expect(first).toEqual(
      expect.objectContaining({
        created: true,
        status: "OPEN",
      }),
    );
    expect(first?.taxResult).toEqual({ ok: true, totalTaxCents: 3_300 });

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: first!.invoiceId },
      include: {
        lineItems: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        taxLines: true,
      },
    });

    expect(invoice.stripeInvoiceId).toBeNull();
    expect(invoice.dueDate?.toISOString()).toBe(signedAt.toISOString());
    expect(invoice.subtotalCents).toBe(44_000);
    expect(invoice.taxCents).toBe(3_300);
    expect(invoice.amountDueCents).toBe(47_300);

    expect(invoice.lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "RENTAL",
          description: "Prepaid rent — Washer (11 months)",
          amountCents: 44_000,
        }),
        expect.objectContaining({
          kind: "TAX",
          description: "Sales tax",
          amountCents: 3_300,
        }),
      ]),
    );
    expect(invoice.taxLines).toEqual([
      expect.objectContaining({
        jurisdictionId: taxFixture.jurisdictionId,
        rateVersionId: taxFixture.rateVersionId,
        category: "RENTAL",
        taxableCents: 44_000,
        taxCents: 3_300,
        source: "ENGINE",
      }),
    ]);

    const second = await prisma.$transaction((tx) =>
      createPrepaidRentInvoiceInTx(tx, agreementId, signedAt),
    );
    expect(second).toEqual(
      expect.objectContaining({
        invoiceId: first!.invoiceId,
        created: false,
        status: "OPEN",
        taxResult: null,
      }),
    );
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(1);
  });
});
