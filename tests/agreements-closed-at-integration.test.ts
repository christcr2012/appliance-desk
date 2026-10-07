import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelAgreement, endAgreementOnAgreedDate } from "@/domains/agreements";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { computeEstimatedEarningsCents } from "@/domains/reports/earnings";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("Batch G agreement closure evidence (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "gclose-owner-" + tag;
  const userId = "gclose-user-" + tag;
  const customerId = "gclose-customer-" + tag;
  const addressId = "gclose-address-" + tag;
  const agreementIds: string[] = [];

  async function createAgreement(input: {
    status?: "ACTIVE" | "SCHEDULED";
    startDate: Date;
    endDate?: Date | null;
    billingStartedAt?: Date | null;
    renewedFromAgreementId?: string | null;
  }) {
    const id = "gclose-agreement-" + agreementIds.length + "-" + tag;
    agreementIds.push(id);
    return prisma.rentalAgreement.create({
      data: {
        id,
        customerId,
        serviceAddressId: addressId,
        status: input.status ?? "ACTIVE",
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        billingStartedAt: input.billingStartedAt ?? null,
        renewedFromAgreementId: input.renewedFromAgreementId ?? null,
        termMonths: input.endDate === null ? null : 12,
        lines: {
          create: [{ label: "Washer", monthlyPriceCents: 6000, listPriceCents: 6000 }],
        },
      },
      include: { lines: true },
    });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: "gclose-owner-" + tag + "@example.test",
          name: "Batch G Closure Owner",
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: userId,
          email: "gclose-" + tag + "@example.test",
          name: "Batch G Closure",
          role: "CUSTOMER",
          emailVerified: true,
        },
      ],
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: "GC" + tag.slice(-20) },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Closure Test Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    });
  });

  afterAll(async () => {
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("stamps cancellation time and stops month-to-month estimated earnings there", async () => {
    const agreement = await createAgreement({
      startDate: new Date("2026-09-01T00:00:00Z"),
      endDate: null,
      billingStartedAt: new Date("2026-09-01T00:00:00Z"),
    });
    const before = Date.now();
    await cancelAgreement(ownerId, agreement.id);
    const after = Date.now();

    const closed = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
      include: { lines: { select: { monthlyPriceCents: true } } },
    });
    expect(closed.status).toBe("CANCELLED");
    expect(closed.endDate).toBeNull();
    expect(closed.closedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(closed.closedAt!.getTime()).toBeLessThanOrEqual(after);

    const input = {
      billingStartedAt: closed.billingStartedAt,
      endDate: closed.endDate,
      closedAt: closed.closedAt,
      lines: closed.lines,
    };
    const atClose = computeEstimatedEarningsCents(input, closed.closedAt!);
    const oneMonthLater = computeEstimatedEarningsCents(
      input,
      new Date(closed.closedAt!.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
    expect(oneMonthLater).toBe(atClose);
  });

  it("keeps an agreed end date separate from the actual closure timestamp", async () => {
    const agreedEnd = new Date("2026-09-11T00:00:00Z");
    const agreement = await createAgreement({
      startDate: new Date("2026-09-01T00:00:00Z"),
      endDate: agreedEnd,
      billingStartedAt: new Date("2026-09-01T00:00:00Z"),
    });

    const before = Date.now();
    await endAgreementOnAgreedDate(agreement.id, agreedEnd);
    const after = Date.now();
    const closed = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreement.id },
      include: { lines: { select: { monthlyPriceCents: true } } },
    });

    expect(closed.status).toBe("ENDED");
    expect(closed.endDate?.toISOString()).toBe(agreedEnd.toISOString());
    expect(closed.closedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(closed.closedAt!.getTime()).toBeLessThanOrEqual(after);
    expect(
      computeEstimatedEarningsCents(
        {
          billingStartedAt: closed.billingStartedAt,
          endDate: closed.endDate,
          closedAt: closed.closedAt,
          lines: closed.lines,
        },
        new Date("2026-10-11T00:00:00Z"),
      ),
    ).toBe(2000);
  });

  it("stamps the direct renewal hand-off close path with the supplied transaction time", async () => {
    const old = await createAgreement({
      startDate: new Date("2025-10-01T00:00:00Z"),
      endDate: new Date("2026-09-30T23:59:59Z"),
      billingStartedAt: new Date("2025-10-01T00:00:00Z"),
    });
    const renewal = await createAgreement({
      status: "SCHEDULED",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2027-09-30T23:59:59Z"),
      renewedFromAgreementId: old.id,
    });
    const now = new Date("2026-10-02T12:00:00Z");

    await expect(startRenewalIfDue(renewal.id, now)).resolves.toMatchObject({ started: true });
    const closed = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: old.id } });
    expect(closed.status).toBe("ENDED");
    expect(closed.closedAt?.toISOString()).toBe(now.toISOString());
  });
});
