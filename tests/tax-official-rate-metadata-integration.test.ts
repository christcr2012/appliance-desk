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

    const results = await prisma.$transaction(async (tx) =>
      Promise.all([
        hasTwoDayRateConfirmationInTx(tx, {
          jurisdictionId,
          asOf,
          rateMilliPercent: 7_700,
          now: new Date("2026-10-07T23:00:00.000Z"),
        }),
        hasTwoDayRateConfirmationInTx(tx, {
          jurisdictionId,
          asOf,
          rateMilliPercent: 7_800,
          now: new Date("2026-10-07T23:00:00.000Z"),
        }),
      ]),
    );
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
      ["Colorado — Sales Tax Rate Changes", "https://tax.colorado.gov/sales-tax-rate-changes"],
      ["Colorado — DR 1002", "https://tax.colorado.gov/DR1002"],
      ["Colorado — Retail Delivery Fee", "https://tax.colorado.gov/retail-delivery-fee"],
      ["Colorado — SUTS Participating Jurisdictions", "https://tax.colorado.gov/SUTS-Jurisdictions"],
      ["Colorado — Sales Tax Changes", "https://tax.colorado.gov/sales-tax-changes"],
      ["City of Greeley — Sales Tax", "https://greeleyco.gov/business/business-operations/sales-tax/"],
    ] as const;

    const rows = await prisma.officialSourceWatch.findMany({
      where: { url: { in: expected.map(([, url]) => url) } },
      select: {
        label: true,
        url: true,
        active: true,
        lastHash: true,
        lastText: true,
        lastCheckedAt: true,
      },
      orderBy: { url: "asc" },
    });

    expect(rows).toHaveLength(expected.length);
    expect(
      rows.map((row) => [row.label, row.url]).sort((a, b) => a[1].localeCompare(b[1])),
    ).toEqual([...expected].sort((a, b) => a[1].localeCompare(b[1])));
    expect(
      rows.every(
        (row) =>
          row.active === false &&
          row.lastHash === null &&
          row.lastText === null &&
          row.lastCheckedAt === null,
      ),
    ).toBe(true);
  });
});
