import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  OFFICIAL_RATE_REASON,
  manuallyApplyObservedRate,
  processOfficialRateCandidate,
  undoAutoAppliedRateVersion,
} from "@/domains/tax/official-rate-auto-apply";
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("T-5b3 guarded official rates (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `official-rate-owner-${tag}`;
  const adminId = `official-rate-admin-${tag}`;
  const jurisdictionId = `official-rate-jurisdiction-${tag}`;
  const jurisdictionCode = `AUTO-${tag.slice(0, 12)}`;
  const baseRateId = `official-rate-base-${tag}`;
  const autoEffective = businessDateFromKey("2027-01-01")!;
  const reviewEffective = businessDateFromKey("2027-07-01")!;
  const dayOne = new Date("2026-10-06T16:00:00.000Z");
  const dayTwo = new Date("2026-10-07T16:00:00.000Z");
  let originalSettings: {
    autoApplyOfficialRateChanges: boolean;
    autoRateChangeMaxMilliPercent: number;
  };

  beforeAll(async () => {
    originalSettings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: {
        autoApplyOfficialRateChanges: true,
        autoRateChangeMaxMilliPercent: true,
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `${tag}-owner@example.test`,
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: adminId,
          email: `${tag}-admin@example.test`,
          role: "ADMIN",
          emailVerified: true,
        },
      ],
    });
    await prisma.taxJurisdiction.create({
      data: {
        id: jurisdictionId,
        code: jurisdictionCode,
        name: "Official rate test jurisdiction",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
        reviewedByUserId: ownerId,
        reviewedAt: dayOne,
      },
    });
    await prisma.taxRateVersion.create({
      data: {
        id: baseRateId,
        jurisdictionId,
        rateMilliPercent: 7_300,
        effectiveFrom: businessDateFromKey("2026-01-01")!,
        source: "MANUAL",
        recordedByUserId: ownerId,
      },
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: {
        autoApplyOfficialRateChanges: true,
        autoRateChangeMaxMilliPercent: 1_000,
      },
    });
  });

  afterAll(async () => {
    await prisma.providerOperation.deleteMany({
      where: { idempotencyKey: { contains: tag } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: { in: [ownerId, adminId] } },
          { action: { startsWith: "OFFICIAL_RATE_" } },
        ],
        entityId: {
          in: (
            await prisma.taxRateVersion.findMany({
              where: { jurisdictionId },
              select: { id: true },
            })
          ).map((row) => row.id),
        },
      },
    });
    await prisma.taxRateObservation.deleteMany({ where: { jurisdictionId } });
    await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: originalSettings,
    });
  });

  it("records the first candidate day without applying", async () => {
    const result = await processOfficialRateCandidate(
      {
        jurisdictionId,
        jurisdictionCode,
        jurisdictionLevel: "CITY",
        effectiveFrom: autoEffective,
        rateMilliPercent: 7_600,
      },
      dayOne,
    );

    expect(result).toEqual([
      expect.objectContaining({ status: "OBSERVED", confirmed: false }),
    ]);
    expect(
      await prisma.taxRateVersion.count({
        where: { jurisdictionId, effectiveFrom: autoEffective },
      }),
    ).toBe(0);
  });

  it("auto applies only after the same candidate is seen on two Colorado dates and stays idempotent", async () => {
    const second = await processOfficialRateCandidate(
      {
        jurisdictionId,
        jurisdictionCode,
        jurisdictionLevel: "CITY",
        effectiveFrom: autoEffective,
        rateMilliPercent: 7_600,
      },
      dayTwo,
    );
    expect(second).toEqual([
      expect.objectContaining({ status: "AUTO_APPLIED" }),
    ]);

    const version = await prisma.taxRateVersion.findFirstOrThrow({
      where: { jurisdictionId, effectiveFrom: autoEffective },
    });
    expect(version).toMatchObject({
      rateMilliPercent: 7_600,
      source: "COLORADO_GIS",
      autoApplied: true,
      autoAppliedUndoneAt: null,
    });

    const repeated = await processOfficialRateCandidate(
      {
        jurisdictionId,
        jurisdictionCode,
        jurisdictionLevel: "CITY",
        effectiveFrom: autoEffective,
        rateMilliPercent: 7_600,
      },
      new Date("2026-10-07T22:00:00.000Z"),
    );
    expect(repeated).toEqual([
      { status: "IGNORED", reason: OFFICIAL_RATE_REASON.RATE_ALREADY_EXISTS },
    ]);
    expect(
      await prisma.taxRateVersion.count({
        where: { jurisdictionId, effectiveFrom: autoEffective },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "OFFICIAL_RATE_AUTO_APPLIED",
          entityId: version.id,
        },
      }),
    ).toBe(1);
  });

  it("requires exact jurisdiction identity and never backdates", async () => {
    await expect(
      processOfficialRateCandidate(
        {
          jurisdictionId,
          jurisdictionCode: `${jurisdictionCode}-wrong`,
          jurisdictionLevel: "CITY",
          effectiveFrom: businessDateFromKey("2027-02-01")!,
          rateMilliPercent: 7_700,
        },
        dayOne,
      ),
    ).resolves.toEqual([
      {
        status: "IGNORED",
        reason: OFFICIAL_RATE_REASON.JURISDICTION_IDENTITY_MISMATCH,
      },
    ]);

    await expect(
      processOfficialRateCandidate(
        {
          jurisdictionId,
          jurisdictionCode,
          jurisdictionLevel: "CITY",
          effectiveFrom: businessDateFromKey("2026-10-05")!,
          rateMilliPercent: 7_700,
        },
        dayOne,
      ),
    ).resolves.toEqual([
      {
        status: "IGNORED",
        reason: OFFICIAL_RATE_REASON.EFFECTIVE_DATE_IN_PAST,
      },
    ]);
  });

  it("turns switch and delta guardrail failures into review and lets only OWNER apply manually", async () => {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: {
        autoApplyOfficialRateChanges: false,
        autoRateChangeMaxMilliPercent: 100,
      },
    });

    await processOfficialRateCandidate(
      {
        jurisdictionId,
        jurisdictionCode,
        jurisdictionLevel: "CITY",
        effectiveFrom: reviewEffective,
        rateMilliPercent: 8_000,
      },
      dayOne,
    );
    const review = await processOfficialRateCandidate(
      {
        jurisdictionId,
        jurisdictionCode,
        jurisdictionLevel: "CITY",
        effectiveFrom: reviewEffective,
        rateMilliPercent: 8_000,
      },
      dayTwo,
    );
    expect(review[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      reasons: expect.arrayContaining([
        OFFICIAL_RATE_REASON.AUTO_APPLY_DISABLED,
        OFFICIAL_RATE_REASON.DELTA_EXCEEDS_LIMIT,
      ]),
    });
    if (review[0]?.status !== "REVIEW_REQUIRED") {
      throw new Error("Expected a review-required decision.");
    }

    await expect(
      manuallyApplyObservedRate({
        observationId: review[0].observationId,
        actorUserId: adminId,
        now: dayTwo,
      }),
    ).rejects.toThrow();

    await prisma.taxJurisdiction.update({
      where: { id: jurisdictionId },
      data: {
        level: "COUNTY",
        reviewStatus: "REVIEWED",
        reviewedByUserId: ownerId,
        reviewedAt: dayTwo,
      },
    });
    await expect(
      manuallyApplyObservedRate({
        observationId: review[0].observationId,
        actorUserId: ownerId,
        now: dayTwo,
      }),
    ).rejects.toThrow("no longer matches the jurisdiction identity");
    await prisma.taxJurisdiction.update({
      where: { id: jurisdictionId },
      data: {
        level: "CITY",
        reviewStatus: "REVIEWED",
        reviewedByUserId: ownerId,
        reviewedAt: dayTwo,
      },
    });

    const manual = await manuallyApplyObservedRate({
      observationId: review[0].observationId,
      actorUserId: ownerId,
      now: dayTwo,
    });
    const version = await prisma.taxRateVersion.findUniqueOrThrow({
      where: { id: manual.rateVersionId },
    });
    expect(version).toMatchObject({
      rateMilliPercent: 8_000,
      source: "COLORADO_GIS",
      autoApplied: false,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: "OFFICIAL_RATE_MANUAL_APPLIED",
          entityId: version.id,
          userId: ownerId,
        },
      }),
    ).toBe(1);
  });

  it("records NO_CURRENT_RATE when Owner overrides a confirmed first rate", async () => {
    const tempId = `official-rate-no-current-${tag}`;
    const tempCode = `NC-${tag.slice(0, 12)}`;
    await prisma.taxJurisdiction.create({
      data: {
        id: tempId,
        code: tempCode,
        name: "No-current official rate test",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
        reviewedByUserId: ownerId,
        reviewedAt: dayOne,
      },
    });

    try {
      await processOfficialRateCandidate(
        {
          jurisdictionId: tempId,
          jurisdictionCode: tempCode,
          jurisdictionLevel: "CITY",
          effectiveFrom: businessDateFromKey("2027-08-01")!,
          rateMilliPercent: 6_500,
        },
        dayOne,
      );
      const review = await processOfficialRateCandidate(
        {
          jurisdictionId: tempId,
          jurisdictionCode: tempCode,
          jurisdictionLevel: "CITY",
          effectiveFrom: businessDateFromKey("2027-08-01")!,
          rateMilliPercent: 6_500,
        },
        dayTwo,
      );
      expect(review[0]).toMatchObject({
        status: "REVIEW_REQUIRED",
        reasons: expect.arrayContaining([OFFICIAL_RATE_REASON.NO_CURRENT_RATE]),
      });
      if (review[0]?.status !== "REVIEW_REQUIRED") {
        throw new Error("Expected a review-required first-rate decision.");
      }

      const applied = await manuallyApplyObservedRate({
        observationId: review[0].observationId,
        actorUserId: ownerId,
        now: dayTwo,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: "OFFICIAL_RATE_MANUAL_APPLIED",
          entityId: applied.rateVersionId,
          userId: ownerId,
        },
        select: { newValue: true },
      });
      const value = audit.newValue as { guardrailReasons?: unknown };
      expect(value.guardrailReasons).toEqual(
        expect.arrayContaining([OFFICIAL_RATE_REASON.NO_CURRENT_RATE]),
      );
    } finally {
      const observations = await prisma.taxRateObservation.findMany({
        where: { jurisdictionId: tempId },
        select: { id: true },
      });
      const versions = await prisma.taxRateVersion.findMany({
        where: { jurisdictionId: tempId },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            {
              entityType: "TaxRateObservation",
              entityId: { in: observations.map((row) => row.id) },
            },
            {
              entityType: "TaxRateVersion",
              entityId: { in: versions.map((row) => row.id) },
            },
          ],
        },
      });
      await prisma.taxRateObservation.deleteMany({ where: { jurisdictionId: tempId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: tempId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: tempId } });
    }
  });

  it("undo is OWNER-only, bounded before the day-before window, and preserves history", async () => {
    const version = await prisma.taxRateVersion.findFirstOrThrow({
      where: {
        jurisdictionId,
        effectiveFrom: autoEffective,
        autoApplied: true,
      },
    });

    await expect(
      undoAutoAppliedRateVersion({
        rateVersionId: version.id,
        actorUserId: adminId,
        now: new Date("2026-12-29T18:00:00.000Z"),
      }),
    ).rejects.toThrow();

    await undoAutoAppliedRateVersion({
      rateVersionId: version.id,
      actorUserId: ownerId,
      now: new Date("2026-12-29T18:00:00.000Z"),
    });

    const undone = await prisma.taxRateVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(undone.autoAppliedUndoneAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          action: "OFFICIAL_RATE_AUTO_APPLY_UNDONE",
          entityId: version.id,
          userId: ownerId,
        },
      }),
    ).toBe(1);

    await expect(
      processOfficialRateCandidate(
        {
          jurisdictionId,
          jurisdictionCode,
          jurisdictionLevel: "CITY",
          effectiveFrom: autoEffective,
          rateMilliPercent: 7_600,
        },
        new Date("2026-12-29T20:00:00.000Z"),
      ),
    ).resolves.toEqual([
      { status: "IGNORED", reason: OFFICIAL_RATE_REASON.RATE_ALREADY_EXISTS },
    ]);

    const tooLateId = `official-rate-too-late-${tag}`;
    await prisma.taxRateVersion.create({
      data: {
        id: tooLateId,
        jurisdictionId,
        rateMilliPercent: 7_700,
        effectiveFrom: businessDateFromKey("2027-02-01")!,
        source: "COLORADO_GIS",
        autoApplied: true,
      },
    });
    await expect(
      undoAutoAppliedRateVersion({
        rateVersionId: tooLateId,
        actorUserId: ownerId,
        now: new Date("2027-01-31T18:00:00.000Z"),
      }),
    ).rejects.toThrow("day-before update window");
  });
});
