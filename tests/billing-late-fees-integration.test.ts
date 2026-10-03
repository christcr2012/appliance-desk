import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { applyLateFees } from "@/domains/billing/late-fees";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("late-fee serialization in disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `late-fee-user-${tag}`;
  const customerId = `late-fee-customer-${tag}`;
  const addressId = `late-fee-address-${tag}`;
  const agreementId = `late-fee-agreement-${tag}`;
  const invoiceId = `late-fee-invoice-${tag}`;

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: invoiceId } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
    await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("two overlapping runs produce exactly one LATE_FEE row and one amount increment", async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `late-fee-${tag}@example.test`,
        name: "Late Fee Customer",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId,
        referralCode: `L${tag.slice(0, 18)}`,
      },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Late Fee Lane",
        city: "Greeley",
        zip: "80631",
      },
    });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        lateFeeGraceDays: 1,
        lateFeeCents: 500,
        lateFeePercent: 0,
      },
    });
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        customerId,
        agreementId,
        status: "DELINQUENT",
        subtotalCents: 10_000,
        amountDueCents: 10_000,
        amountPaidCents: 0,
        dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });

    const runs = await Promise.all([applyLateFees(), applyLateFees()]);
    expect(runs.flat().filter((row) => row.invoiceId === invoiceId)).toHaveLength(1);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.lateFeeCents).toBe(500);
    expect(invoice.amountDueCents).toBe(10_500);
    expect(
      await prisma.invoiceLineItem.count({
        where: { invoiceId, kind: "LATE_FEE" },
      }),
    ).toBe(1);

    await expect(
      prisma.invoiceLineItem.create({
        data: {
          invoiceId,
          kind: "LATE_FEE",
          description: "Duplicate late fee should fail",
          amountCents: 500,
        },
      }),
    ).rejects.toThrow();
  });
});
