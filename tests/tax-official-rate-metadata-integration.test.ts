import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  hasTwoDayRateConfirmationInTx,
  pruneTaxRateObservationsInTx,
  recordTaxRateObservationInTx,
} from "@/domains/tax/official-rate-metadata";
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("T-5b1 official rate metadata (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const jurisdictionId = `official-rate-jurisdiction-${tag}`;
  const jurisdictionCode = `META-${tag.slice(0, 16)}`;

  beforeAll(async () => {
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId,
        code: jurisdictionCode,
        name: "Official-rate metadata test jurisdiction",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
  });

  afterAll(async () => {
    await prisma.taxRateObservation.deleteMany({ where: { jurisdictionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
  });

  it("defaults official-rate auto apply on with a 1000 milli-percent guardrail", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: {
        autoApplyOfficialRateChanges: true,
        autoRateChangeMaxMilliPercent: true,
      },
    });

    expect(settings).toEqual({
      autoApplyOfficialRateChanges: true,
      autoRateChangeMaxMilliPercent: 1000,
    });
  });

  it("rejects a negative candidate rate before writing", async () => {
    const asOf = businessDateFromKey("2027-01-02")!;

    await expect(
      prisma.$transaction((tx) =>
        recordTaxRateObservationInTx(tx, {
          jurisdictionId,
          asOf,
          rateMilliPercent: -1,
          observedAt: new Date("2026-10-06T15:00:00.000Z"),
        }),
      ),
    ).rejects.toThrow("rateMilliPercent must be a non-negative integer");

    expect(
      await prisma.taxRateObservation.count({
        where: { jurisdictionId, asOf },
      }),
    ).toBe(0);
  });

  it("records repeated same-day observations idempotently", async () => {
    const asOf = businessDateFromKey("2027-01-01")!;
    const firstObservedAt = new Date("2026-10-06T15:00:00.000Z");
    const repeatedObservedAt = new Date("2026-10-06T22:00:00.000Z");

    const [first, repeated] = await prisma.$transaction(async (tx) => {
      const first = await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_500,
        observedAt: firstObservedAt,
      });
      const repeated = await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_500,
        observedAt: repeatedObservedAt,
      });
      return [first, repeated] as const;
    });

    expect(repeated.id).toBe(first.id);
    expect(
      await prisma.taxRateObservation.count({
        where: { jurisdictionId, asOf, rateMilliPercent: 7_500 },
      }),
    ).toBe(1);
  });

  it("serializes concurrent same-day observations to one evidence row", async () => {
    const asOf = businessDateFromKey("2027-01-03")!;
    const input = {
      jurisdictionId,
      asOf,
      rateMilliPercent: 7_550,
      observedAt: new Date("2026-10-06T16:00:00.000Z"),
    };

    const [first, second] = await Promise.all([
      prisma.$transaction((tx) => recordTaxRateObservationInTx(tx, input)),
      prisma.$transaction((tx) => recordTaxRateObservationInTx(tx, input)),
    ]);

    expect(second.id).toBe(first.id);
    expect(
      await prisma.taxRateObservation.count({
        where: {
          jurisdictionId,
          asOf,
          rateMilliPercent: input.rateMilliPercent,
        },
      }),
    ).toBe(1);
  });

  it("serializes concurrent same-day observations to one row", async () => {
    const asOf = businessDateFromKey("2027-01-03")!;
    const observedAt = new Date("2026-10-06T18:00:00.000Z");

    const [first, second] = await Promise.all([
      prisma.$transaction((tx) =>
        recordTaxRateObservationInTx(tx, {
          jurisdictionId,
          asOf,
          rateMilliPercent: 7_550,
          observedAt,
        }),
      ),
      prisma.$transaction((tx) =>
        recordTaxRateObservationInTx(tx, {
          jurisdictionId,
          asOf,
          rateMilliPercent: 7_550,
          observedAt: new Date("2026-10-06T22:00:00.000Z"),
        }),
      ),
    ]);

    expect(second.id).toBe(first.id);
    expect(
      await prisma.taxRateObservation.count({
        where: { jurisdictionId, asOf, rateMilliPercent: 7_550 },
      }),
    ).toBe(1);
  });

  it("requires the same rate on two distinct Colorado dates for confirmation", async () => {
    const asOf = businessDateFromKey("2027-07-01")!;
    const dayOne = new Date("2026-10-06T15:00:00.000Z");
    const dayTwo = new Date("2026-10-07T15:00:00.000Z");

    const beforeSecondDay = await prisma.$transaction(async (tx) => {
      await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_600,
        observedAt: dayOne,
      });
      return hasTwoDayRateConfirmationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_600,
        now: new Date("2026-10-06T23:00:00.000Z"),
      });
    });
    expect(beforeSecondDay).toBe(false);

    const afterSecondDay = await prisma.$transaction(async (tx) => {
      await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_600,
        observedAt: dayTwo,
      });
      return hasTwoDayRateConfirmationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_600,
        now: new Date("2026-10-07T23:00:00.000Z"),
      });
    });
    expect(afterSecondDay).toBe(true);
  });

  it("does not confirm two different candidate rates", async () => {
    const asOf = businessDateFromKey("2028-01-01")!;

    await prisma.$transaction(async (tx) => {
      await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_700,
        observedAt: new Date("2026-10-06T15:00:00.000Z"),
      });
      await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_800,
        observedAt: new Date("2026-10-07T15:00:00.000Z"),
      });
    });

    const results = await prisma.$transaction(async (tx) => {
      const firstRate = await hasTwoDayRateConfirmationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_700,
        now: new Date("2026-10-07T23:00:00.000Z"),
      });
      const secondRate = await hasTwoDayRateConfirmationInTx(tx, {
        jurisdictionId,
        asOf,
        rateMilliPercent: 7_800,
        now: new Date("2026-10-07T23:00:00.000Z"),
      });
      return [firstRate, secondRate];
    });
    expect(results).toEqual([false, false]);
  });

  it("prunes observations older than one Colorado year boundary", async () => {
    const oldAsOf = businessDateFromKey("2028-07-01")!;
    const boundaryAsOf = businessDateFromKey("2029-01-01")!;
    const recentAsOf = businessDateFromKey("2029-07-01")!;

    const ids = await prisma.$transaction(async (tx) => {
      const old = await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf: oldAsOf,
        rateMilliPercent: 7_900,
        observedAt: new Date("2025-10-06T18:00:00.000Z"),
      });
      const boundary = await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf: boundaryAsOf,
        rateMilliPercent: 8_000,
        observedAt: new Date("2025-10-07T18:00:00.000Z"),
      });
      const recent = await recordTaxRateObservationInTx(tx, {
        jurisdictionId,
        asOf: recentAsOf,
        rateMilliPercent: 8_100,
        observedAt: new Date("2026-10-07T18:00:00.000Z"),
      });
      return { old: old.id, boundary: boundary.id, recent: recent.id };
    });

    const deleted = await prisma.$transaction((tx) =>
      pruneTaxRateObservationsInTx(
        tx,
        new Date("2026-10-07T18:00:00.000Z"),
      ),
    );
    expect(deleted).toBe(1);

    const remaining = await prisma.taxRateObservation.findMany({
      where: { id: { in: [ids.old, ids.boundary, ids.recent] } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [ids.boundary, ids.recent].sort(),
    );
  });

  it("seeds the six official sources inactive with unique URLs", async () => {
    const expected = [
      {
        label: "Colorado — DR 1002",
        url: "https://tax.colorado.gov/DR1002",
      },
      {
        label: "Colorado — Retail Delivery Fee",
        url: "https://tax.colorado.gov/retail-delivery-fee",
      },
      {
        label: "Colorado — SUTS Participating Jurisdictions",
        url: "https://tax.colorado.gov/SUTS-Jurisdictions",
      },
      {
        label: "Colorado — Sales Tax Changes",
        url: "https://tax.colorado.gov/sales-tax-changes",
      },
      {
        label: "Colorado — Sales Tax Rate Changes",
        url: "https://tax.colorado.gov/sales-tax-rate-changes",
      },
      {
        label: "City of Greeley — Sales Tax",
        url: "https://greeleyco.gov/business/business-operations/sales-tax/",
      },
    ];

    const rows = await prisma.officialSourceWatch.findMany({
      where: { url: { in: expected.map((row) => row.url) } },
      select: {
        label: true,
        url: true,
        active: true,
        lastHash: true,
        lastText: true,
        lastExcerpt: true,
        lastCheckedAt: true,
        lastChangedAt: true,
        lastError: true,
        reviewedAt: true,
      },
      orderBy: { url: "asc" },
    });

    expect(rows).toHaveLength(expected.length);
    expect(rows.map(({ label, url }) => ({ label, url })).sort((a, b) => a.url.localeCompare(b.url))).toEqual(
      [...expected].sort((a, b) => a.url.localeCompare(b.url)),
    );
    expect(
      rows.every(
        (row) =>
          row.active === false &&
          row.lastHash === null &&
          row.lastText === null &&
          row.lastExcerpt === null &&
          row.lastCheckedAt === null &&
          row.lastChangedAt === null &&
          row.lastError === null &&
          row.reviewedAt === null,
      ),
    ).toBe(true);
  });
});
