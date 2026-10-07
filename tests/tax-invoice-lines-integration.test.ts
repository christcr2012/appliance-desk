import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { computeAgreementInvoiceTax } from "@/domains/tax/invoice-tax";
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
      },
    });
    taxReady = await seedTaxReadyContext(addressId, { rateMilliPercent: 1000 });
  });

  beforeEach(async () => {
    await prisma.addressTaxLocation.updateMany({
      where: { serviceAddressId: addressId, isCurrent: true },
      data: { status: "VERIFIED" },
    });
  });

  afterAll(async () => {
    await taxReady.cleanup();
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
