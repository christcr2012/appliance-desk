import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BACKUP_TABLES } from "@/domains/backup/manifest";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const migration = readFileSync(
  "prisma/migrations/20261006010000_batch_b2_lifecycle/migration.sql",
  "utf8",
);

function dataStep(n: number) {
  const match = migration.match(
    new RegExp(`-- DATA STEP ${n} START\\n([\\s\\S]*?)-- DATA STEP ${n} END`),
  );
  if (!match?.[1]) throw new Error(`Missing Batch B2 migration data step ${n}`);
  return match[1].trim();
}

async function runDataSteps() {
  for (const n of [2, 3, 4, 5]) await prisma.$executeRawUnsafe(dataStep(n));
}

describe.skipIf(!enabled)("Batch B2 migration (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `b2-migration-user-${tag}`;
  const customerId = `b2-migration-customer-${tag}`;
  const addressId = `b2-migration-address-${tag}`;
  const rootId = `b2-migration-root-${tag}`;
  const secondId = `b2-migration-second-${tag}`;
  const thirdId = `b2-migration-third-${tag}`;
  const rootDelivered = new Date("2026-01-15T07:00:00.000Z");

  let originalSettings: {
    earlyTerminationNoticeDays: number | null;
    terminationTermsText: string | null;
    termsChangeNoticeText: string | null;
    annualReminderText: string | null;
  };

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    originalSettings = {
      earlyTerminationNoticeDays: settings.earlyTerminationNoticeDays,
      terminationTermsText: settings.terminationTermsText,
      termsChangeNoticeText: settings.termsChangeNoticeText,
      annualReminderText: settings.annualReminderText,
    };

    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: { id: customerId, userId, referralCode: `B2${tag.slice(0, 10)}` },
    });
    await prisma.serviceAddress.create({
      data: {
        id: addressId,
        customerId,
        line1: "1 Migration Test Way",
        city: "Greeley",
        state: "CO",
        zip: "80631",
      },
    });
    await prisma.rentalAgreement.createMany({
      data: [
        {
          id: rootId,
          customerId,
          serviceAddressId: addressId,
          status: "ENDED",
          termMonths: 6,
          firstDeliveredOn: rootDelivered,
        },
        {
          id: secondId,
          customerId,
          serviceAddressId: addressId,
          status: "ENDED",
          termMonths: 6,
          renewedFromAgreementId: rootId,
        },
        {
          id: thirdId,
          customerId,
          serviceAddressId: addressId,
          status: "ACTIVE",
          termMonths: null,
          renewedFromAgreementId: secondId,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.earlyReturnResolution.deleteMany({ where: { agreementId: { in: [rootId, secondId, thirdId] } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: [rootId, secondId, thirdId] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.monthToMonthTermsVersion.deleteMany({ where: { id: "mtm-terms-v1" } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: originalSettings,
    });
  });

  it("seeds version 1 only when both source values exist", async () => {
    await prisma.monthToMonthTermsVersion.deleteMany({ where: { id: "mtm-terms-v1" } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { earlyTerminationNoticeDays: 30, terminationTermsText: null },
    });
    await prisma.$executeRawUnsafe(dataStep(2));
    expect(await prisma.monthToMonthTermsVersion.findUnique({ where: { version: 1 } })).toBeNull();

    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { terminationTermsText: "Month-to-month test wording" },
    });
    await prisma.$executeRawUnsafe(dataStep(2));
    expect(await prisma.monthToMonthTermsVersion.findUnique({ where: { version: 1 } })).toMatchObject({
      noticeDays: 30,
      termsText: "Month-to-month test wording",
    });
  });

  it("backfills a three-link continuity chain from the root delivery fact", async () => {
    await prisma.rentalAgreement.updateMany({
      where: { id: { in: [rootId, secondId, thirdId] } },
      data: { continuityRootId: null, continuousSince: null, monthToMonthTermsVersion: null },
    });
    await prisma.$executeRawUnsafe(dataStep(3));
    await prisma.$executeRawUnsafe(dataStep(4));

    const rows = await prisma.rentalAgreement.findMany({
      where: { id: { in: [rootId, secondId, thirdId] } },
      orderBy: { id: "asc" },
      select: { id: true, continuityRootId: true, continuousSince: true, monthToMonthTermsVersion: true },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.continuityRootId).toBe(rootId);
      expect(row.continuousSince?.toISOString()).toBe(rootDelivered.toISOString());
    }
    expect(rows.find((row) => row.id === thirdId)?.monthToMonthTermsVersion).toBe(1);
  });

  it("the migration data steps are idempotent", async () => {
    await runDataSteps();
    const before = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: thirdId },
      select: { continuityRootId: true, continuousSince: true, monthToMonthTermsVersion: true },
    });
    const versionCount = await prisma.monthToMonthTermsVersion.count({ where: { version: 1 } });
    await runDataSteps();
    const after = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: thirdId },
      select: { continuityRootId: true, continuousSince: true, monthToMonthTermsVersion: true },
    });
    expect(after).toEqual(before);
    expect(await prisma.monthToMonthTermsVersion.count({ where: { version: 1 } })).toBe(versionCount);
  });

  it("backs up every Batch B2 persisted table", () => {
    expect(BACKUP_TABLES).toEqual(
      expect.arrayContaining([
        "subscriptionEndIntent",
        "lateReturnWaiver",
        "monthToMonthTermsVersion",
        "earlyReturnResolution",
      ]),
    );
  });
});
