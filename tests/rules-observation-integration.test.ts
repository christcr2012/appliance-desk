import { randomUUID } from "node:crypto";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  approveRuleChange,
  dismissRuleChange,
  listRuleChangeAttention,
  recordRuleObservationInTx,
} from "@/domains/rules/observations";
import { undoRuleVersion } from "@/domains/rules/changes";
import { ruleAsOf } from "@/domains/rules/reads";
import { businessDateFromKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const DAY2 = new Date("2026-10-27T12:00:00.000Z");

describe.skipIf(!enabled)("TFA-3 rule observations (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const prefix = `tfa3-${tag}-`;
  let ownerId = "";
  const versionIds: string[] = [];

  async function createWatch(suffix: string, parserKey: string | null = null) {
    return prisma.officialSourceWatch.create({
      data: {
        id: `${prefix}${suffix}`,
        label: `TFA-3 watch ${suffix}`,
        url: `https://watch-${suffix}-${tag}.example.gov/page`,
        active: true,
        parserKey,
      },
    });
  }

  async function record(
    watchId: string,
    input: { ruleKey: string; value: unknown; effectiveFrom: Date | null },
    observedAt: Date,
  ) {
    return prisma.$transaction((tx) =>
      recordRuleObservationInTx(tx, {
        ruleKey: input.ruleKey,
        value: input.value,
        effectiveFrom: input.effectiveFrom,
        watchId,
        evidence: "Fixture evidence from the official page.",
        observedAt,
      }),
    );
  }

  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { role: "OWNER", archivedAt: null },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    ownerId = owner.id;
  });

  afterEach(async () => {
    await prisma.legalRuleObservation.deleteMany({
      where: { watchId: { startsWith: prefix } },
    });
    if (versionIds.length) {
      await prisma.legalRuleVersion.deleteMany({ where: { id: { in: versionIds } } });
      versionIds.length = 0;
    }
    await prisma.officialSourceWatch.deleteMany({
      where: { id: { startsWith: prefix } },
    });
  });

  it("stores the same reading once per business day", async () => {
    const watch = await createWatch("dedupe", "CO_INTEREST");
    const input = {
      ruleKey: "co.interest",
      value: { regular: 11, discounted: 8 },
      effectiveFrom: businessDateFromKey("2030-01-01"),
    };
    const first = await record(watch.id, input, NOW);
    const again = await record(watch.id, input, NOW);
    expect(again.id).toBe(first.id);
    const nextDay = await record(watch.id, input, DAY2);
    expect(nextDay.id).not.toBe(first.id);
    expect(
      await prisma.legalRuleObservation.count({ where: { watchId: watch.id } }),
    ).toBe(2);
  });

  it("an identical reading asks nothing; a differing one appears, with two-day agreement", async () => {
    const watch = await createWatch("attention", "RDF_RATES");
    // The seeded rule book already says 31 cents from 2026-07-01.
    await record(watch.id, {
      ruleKey: "co.rdf.amount", value: 31, effectiveFrom: businessDateFromKey("2026-07-01"),
    }, NOW);
    let items = await listRuleChangeAttention(NOW);
    expect(items.some((item) => item.observationId !== "" && item.ruleKey === "co.rdf.amount"
      && item.effectiveFrom?.getTime() === businessDateFromKey("2026-07-01")!.getTime())).toBe(false);

    const reading = await record(watch.id, {
      ruleKey: "co.rdf.amount", value: 33, effectiveFrom: businessDateFromKey("2027-07-01"),
    }, NOW);
    items = await listRuleChangeAttention(NOW);
    const item = items.find((entry) => entry.observationId === reading.id);
    expect(item).toBeTruthy();
    expect(item!.readOnTwoDays).toBe(false);
    expect(item!.plausible).toBe(true);
    expect(item!.startPassed).toBe(false);

    await record(watch.id, {
      ruleKey: "co.rdf.amount", value: 33, effectiveFrom: businessDateFromKey("2027-07-01"),
    }, DAY2);
    items = await listRuleChangeAttention(DAY2);
    expect(items.find((entry) => entry.ruleKey === "co.rdf.amount"
      && entry.effectiveFrom?.getTime() === businessDateFromKey("2027-07-01")!.getTime())!.readOnTwoDays).toBe(true);
  });

  it("flags an unusually large jump as not plausible", async () => {
    const watch = await createWatch("plausibility", "RDF_RATES");
    const reading = await record(watch.id, {
      ruleKey: "co.rdf.amount", value: 95, effectiveFrom: businessDateFromKey("2027-07-01"),
    }, NOW);
    const items = await listRuleChangeAttention(NOW);
    expect(items.find((entry) => entry.observationId === reading.id)!.plausible).toBe(false);
  });

  it("approve writes an OFFICIAL_WATCH version for the stated date, never earlier", async () => {
    const watch = await createWatch("approve", "RDF_RATES");
    const reading = await record(watch.id, {
      ruleKey: "co.rdf.amount", value: 33, effectiveFrom: businessDateFromKey("2028-07-01"),
    }, NOW);
    const before = await ruleAsOf<number>("co.rdf.amount", businessDateFromKey("2028-06-30")!);
    const { versionId } = await approveRuleChange(reading.id, ownerId, NOW);
    versionIds.push(versionId);

    const version = await prisma.legalRuleVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.origin).toBe("OFFICIAL_WATCH");
    expect(version.provisional).toBe(false);
    expect(version.createdByUserId).toBe(ownerId);
    expect(version.effectiveFrom.getTime()).toBe(businessDateFromKey("2028-07-01")!.getTime());

    const after = await ruleAsOf<number>("co.rdf.amount", businessDateFromKey("2028-07-02")!);
    expect(after.value).toBe(33);
    const stillBefore = await ruleAsOf<number>("co.rdf.amount", businessDateFromKey("2028-06-30")!);
    expect(stillBefore.value).toBe(before.value);

    const stored = await prisma.legalRuleObservation.findUniqueOrThrow({ where: { id: reading.id } });
    expect(stored.approvedVersionId).toBe(versionId);
    const items = await listRuleChangeAttention(NOW);
    expect(items.some((entry) => entry.observationId === reading.id)).toBe(false);
  });

  it("approve after the start date lands the version at its real date (late-change path)", async () => {
    const watch = await createWatch("late", "IRS_1099_THRESHOLD");
    const reading = await record(watch.id, {
      ruleKey: "us.1099.threshold", value: 250000, effectiveFrom: businessDateFromKey("2027-01-01"),
    }, NOW);
    const { versionId } = await approveRuleChange(reading.id, ownerId, new Date("2027-02-01T12:00:00.000Z"));
    versionIds.push(versionId);
    const asOf = await ruleAsOf<number>("us.1099.threshold", businessDateFromKey("2027-01-15")!);
    expect(asOf.value).toBe(250000);
    const before = await ruleAsOf<number>("us.1099.threshold", businessDateFromKey("2026-12-31")!);
    expect(before.value).toBe(200000);
  });

  it("dismiss with a note settles the reading; a changed value asks again", async () => {
    const watch = await createWatch("dismiss", "CO_INTEREST");
    const reading = await record(watch.id, {
      ruleKey: "co.interest", value: { regular: 13, discounted: 10 },
      effectiveFrom: businessDateFromKey("2028-01-01"),
    }, NOW);
    await dismissRuleChange(reading.id, ownerId, "The page was a draft.", NOW);
    const stored = await prisma.legalRuleObservation.findUniqueOrThrow({ where: { id: reading.id } });
    expect(stored.dismissNote).toBe("The page was a draft.");

    // The same reading on a later day does not re-ask.
    await record(watch.id, {
      ruleKey: "co.interest", value: { regular: 13, discounted: 10 },
      effectiveFrom: businessDateFromKey("2028-01-01"),
    }, DAY2);
    let items = await listRuleChangeAttention(DAY2);
    expect(items.some((entry) => entry.ruleKey === "co.interest"
      && entry.effectiveFrom?.getTime() === businessDateFromKey("2028-01-01")!.getTime())).toBe(false);

    // A different value for the same rule and date is a new reading.
    const changed = await record(watch.id, {
      ruleKey: "co.interest", value: { regular: 14, discounted: 10 },
      effectiveFrom: businessDateFromKey("2028-01-01"),
    }, DAY2);
    items = await listRuleChangeAttention(DAY2);
    expect(items.some((entry) => entry.observationId === changed.id)).toBe(true);
  });

  it("an approved watch version can be undone before its start date", async () => {
    const watch = await createWatch("undo", "CO_INTEREST");
    const reading = await record(watch.id, {
      ruleKey: "co.interest", value: { regular: 12, discounted: 9 },
      effectiveFrom: businessDateFromKey("2029-01-01"),
    }, NOW);
    const { versionId } = await approveRuleChange(reading.id, ownerId, NOW);
    versionIds.push(versionId);
    await undoRuleVersion(ownerId, versionId, NOW);
    const version = await prisma.legalRuleVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.undoneAt).not.toBeNull();
    const asOf = await ruleAsOf<{ regular: number; discounted: number }>(
      "co.interest", businessDateFromKey("2029-06-01")!,
    );
    expect(asOf.value).toEqual({ regular: 11, discounted: 8 });
  });

  it("a reading with no start date cannot be approved", async () => {
    const watch = await createWatch("nodate", "GREELEY_RATE");
    const reading = await record(watch.id, {
      ruleKey: "greeley.sales_rate", value: 4710, effectiveFrom: null,
    }, NOW);
    await expect(approveRuleChange(reading.id, ownerId, NOW)).rejects.toThrow("no start date");
  });

  it("nothing is applied automatically: readings create no versions and auto-apply starts off", async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { autoApplyOfficialRateChanges: true },
    });
    expect(settings.autoApplyOfficialRateChanges).toBe(false);

    const versionsBefore = await prisma.legalRuleVersion.count({
      where: { ruleKey: "co.rdf.amount", effectiveFrom: businessDateFromKey("2031-07-01")! },
    });
    const watch = await createWatch("noauto", "RDF_RATES");
    await record(watch.id, {
      ruleKey: "co.rdf.amount", value: 34, effectiveFrom: businessDateFromKey("2031-07-01"),
    }, NOW);
    const versionsAfter = await prisma.legalRuleVersion.count({
      where: { ruleKey: "co.rdf.amount", effectiveFrom: businessDateFromKey("2031-07-01")! },
    });
    expect(versionsAfter).toBe(versionsBefore);
  });
});
