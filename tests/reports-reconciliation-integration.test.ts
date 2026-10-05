// Real-Postgres proof that the Reports numbers equal their source rows (docs/designs/BATCH-D.md D3). CI / sandbox only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getEarningsReport } from "@/domains/reports";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("earnings report reconciles to the invoice, payment and refund rows", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `rr-u-${tag}`;
  const customerId = `rr-c-${tag}`;
  const addressId = `rr-a-${tag}`;
  const agreementId = `rr-ag-${tag}`;
  const asOf = new Date("2026-10-05T18:00:00Z");

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Report Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Report St", city: "Greeley", zip: "80631" } });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        // Exactly 60 days before asOf.
        billingStartedAt: new Date(asOf.getTime() - 60 * 86_400_000),
        lines: { create: [{ label: "Set", monthlyPriceCents: 2_000 }, { label: "Range", monthlyPriceCents: 1_000 }] },
      },
    });
    const inv = (id: string, status: "PAID" | "OPEN" | "WRITTEN_OFF" | "PARTIALLY_PAID", paid: number) =>
      prisma.invoice.create({ data: { id: `${id}-${tag}`, customerId, agreementId, status, subtotalCents: 3_000, amountDueCents: 3_000, amountPaidCents: paid } });
    await inv("rr-paid", "PAID", 3_000);
    await inv("rr-open", "OPEN", 0);
    await inv("rr-off", "WRITTEN_OFF", 0);
    await inv("rr-part", "PARTIALLY_PAID", 500);
    await prisma.refund.create({ data: { invoiceId: `rr-paid-${tag}`, amountCents: 1_000, reason: "GOODWILL" } });
  });

  afterAll(async () => {
    await prisma.refund.deleteMany({ where: { invoice: { customerId } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("estimated = agreed monthly total x days / 30; collected = paid - refunded; unpaid and written-off add nothing", async () => {
    const report = await getEarningsReport(asOf);
    const row = report.rows.find((r) => r.agreementId === agreementId)!;
    // $30.00/month for 60 days = $60.00.
    expect(row.estimatedCents).toBe(6_000);
    // $30.00 paid - $10.00 refunded + $5.00 part-paid = $25.00.
    expect(row.actualCents).toBe(2_500);
    expect(row.gapCents).toBe(3_500);
  });

  it("the totals are the sum of the rows", async () => {
    const report = await getEarningsReport(asOf);
    expect(report.totals.estimatedCents).toBe(report.rows.reduce((s, r) => s + r.estimatedCents, 0));
    expect(report.totals.actualCents).toBe(report.rows.reduce((s, r) => s + r.actualCents, 0));
    expect(report.totals.gapCents).toBe(report.totals.estimatedCents - report.totals.actualCents);
  });
});
