import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/domains/tax/safe-official-source-fetch", () => ({
  fetchOfficialSourcePage: mocks.fetchPage,
}));
vi.mock("@/lib/session", () => ({
  requireRole: mocks.requireRole,
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({
    sent: false,
    outcome: "NOT_ATTEMPTED" as const,
  })),
}));
vi.mock("@/lib/customer-email", () => ({
  sendCustomerEmail: vi.fn(async () => ({
    sent: false,
    outcome: "NOT_ATTEMPTED" as const,
  })),
}));
vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async () => {
    throw new Error("Preview watch tests must never send SMS.");
  }),
  getSmsProviderState: vi.fn(async () => "UNKNOWN"),
}));

import { readFileSync } from "node:fs";
import path from "node:path";

import { getExceptionOverview } from "@/domains/exceptions";
import { listOfficialRateAttention } from "@/domains/tax/official-rate-auto-apply";
import {
  acknowledgeOfficialSourceChange,
  buildOfficialSourceChangeExcerpt,
  runOfficialSourceWatch,
} from "@/domains/tax/official-source-watch";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const MONDAY = new Date("2026-10-05T18:00:00.000Z");
const TUESDAY = new Date("2026-10-06T18:00:00.000Z");

describe.skipIf(!enabled)("T-5b2 official source watch (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const prefix = `watch-${tag}-`;
  let ownerId = "";

  async function createWatch(
    suffix: string,
    data: {
      active?: boolean;
      parserKey?: string | null;
      lastHash?: string | null;
      lastText?: string | null;
      lastExcerpt?: string | null;
      lastChangedAt?: Date | null;
      reviewedAt?: Date | null;
      consecutiveFailures?: number;
    } = {},
  ) {
    return prisma.officialSourceWatch.create({
      data: {
        id: `${prefix}${suffix}`,
        label: `Colorado source ${suffix}`,
        url: `https://source-${suffix}-${tag}.example.gov/page`,
        active: data.active ?? true,
        parserKey: data.parserKey ?? null,
        lastHash: data.lastHash ?? null,
        lastText: data.lastText ?? null,
        lastExcerpt: data.lastExcerpt ?? null,
        lastChangedAt: data.lastChangedAt ?? null,
        reviewedAt: data.reviewedAt ?? null,
        consecutiveFailures: data.consecutiveFailures ?? 0,
      },
    });
  }

  // The migration-managed watch ids (TFA-3 activates the six seeded rows
  // and adds three parser rows); restored in afterAll.
  const SEEDED_WATCH_IDS = [
    "official-source-colorado-rate-changes",
    "official-source-colorado-dr1002",
    "official-source-colorado-retail-delivery-fee",
    "official-source-colorado-suts-jurisdictions",
    "official-source-colorado-sales-tax-changes",
    "official-source-greeley-sales-tax",
    "official-source-colorado-retail-delivery-fee-rates",
    "official-source-irs-1099-instructions",
    "official-source-colorado-penalties-interest",
  ];

  beforeAll(async () => {
    const owner = await prisma.user.findFirstOrThrow({
      where: { role: "OWNER", archivedAt: null },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    ownerId = owner.id;
    mocks.requireRole.mockResolvedValue({
      user: { id: ownerId, role: "OWNER" },
    });
    // TFA-3 turned the seeded watches on; these tests scope the runner to
    // their own watches so the real official URLs are never fetched here.
    await prisma.officialSourceWatch.updateMany({
      where: { active: true, id: { not: { startsWith: prefix } } },
      data: { active: false },
    });
  });

  beforeEach(() => {
    mocks.fetchPage.mockReset();
  });

  afterEach(async () => {
    const taskRows = await prisma.staffTask.findMany({
      where: { sourceKey: { startsWith: "tax-cpa-annual-review:2099" } },
      select: { id: true },
    });
    const taskIds = taskRows.map((row) => row.id);

    await prisma.messageDelivery.deleteMany({
      where: {
        subjectType: "OfficialSourceWatch",
        subjectId: { startsWith: prefix },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          {
            entityType: "OfficialSourceWatch",
            entityId: { startsWith: prefix },
          },
          ...(taskIds.length
            ? [
                {
                  entityType: "StaffTask",
                  entityId: { in: taskIds },
                },
              ]
            : []),
        ],
      },
    });
    await prisma.staffTask.deleteMany({
      where: { sourceKey: { startsWith: "tax-cpa-annual-review:2099" } },
    });
    await prisma.legalRuleObservation.deleteMany({
      where: { watchId: { startsWith: prefix } },
    });
    await prisma.officialSourceWatch.deleteMany({
      where: { id: { startsWith: prefix } },
    });
  });

  afterAll(async () => {
    mocks.requireRole.mockReset();
    await prisma.officialSourceWatch.updateMany({
      where: { id: { in: SEEDED_WATCH_IDS } },
      data: { active: true },
    });
  });

  it("centers a long-line excerpt on the actual changed characters", () => {
    const sharedPrefix = "same ".repeat(180);
    const excerpt = buildOfficialSourceChangeExcerpt(
      `${sharedPrefix}OLD_MARKER trailing context`,
      `${sharedPrefix}NEW_MARKER trailing context`,
    );

    expect(excerpt).toContain("NEW_MARKER");
    expect(excerpt).toContain("OLD_MARKER");
    expect(excerpt.length).toBeLessThanOrEqual(700);
  });

  it("first successful observation initializes without alerting", async () => {
    const watch = await createWatch("first");
    mocks.fetchPage.mockResolvedValue({
      finalUrl: watch.url,
      contentType: "text/html",
      text: "Official page\nInitial content",
      hash: "hash-first",
    });

    const result = await runOfficialSourceWatch(MONDAY);

    expect(result).toEqual({
      checked: 1,
      changed: 0,
      recovered: 0,
      failed: 0,
      observations: 0,
    });
    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.lastHash).toBe("hash-first");
    expect(stored.lastText).toBe("Official page\nInitial content");
    expect(stored.lastChangedAt).toBeNull();
    expect(
      await prisma.messageDelivery.count({
        where: { subjectType: "OfficialSourceWatch", subjectId: watch.id },
      }),
    ).toBe(0);
  });

  it("continues to later sources when one watch disappears during processing", async () => {
    const deleted = await createWatch("deleted-first");
    const later = await createWatch("later");

    mocks.fetchPage.mockImplementation(async (sourceUrl: string) => {
      if (sourceUrl === deleted.url) {
        await prisma.officialSourceWatch.delete({ where: { id: deleted.id } });
        return {
          finalUrl: deleted.url,
          contentType: "text/plain",
          text: "Deleted source content",
          hash: "deleted-hash",
        };
      }
      return {
        finalUrl: later.url,
        contentType: "text/plain",
        text: "Later source content",
        hash: "later-hash",
      };
    });

    const result = await runOfficialSourceWatch(MONDAY);

    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
    const storedLater = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: later.id },
    });
    expect(storedLater.lastHash).toBe("later-hash");
  });

  it("does no source fetch work on a non-Monday Colorado date", async () => {
    await createWatch("tuesday");

    expect(await runOfficialSourceWatch(TUESDAY)).toEqual({
      checked: 0,
      changed: 0,
      recovered: 0,
      failed: 0,
      observations: 0,
    });
    expect(mocks.fetchPage).not.toHaveBeenCalled();
  });

  it("unchanged Monday check preserves reviewed change evidence", async () => {
    const changedAt = new Date("2026-09-28T18:00:00.000Z");
    const reviewedAt = new Date("2026-09-29T18:00:00.000Z");
    const watch = await createWatch("unchanged", {
      lastHash: "stable-hash",
      lastText: "Stable content",
      lastExcerpt: "Added: Stable content",
      lastChangedAt: changedAt,
      reviewedAt,
      consecutiveFailures: 2,
    });
    mocks.fetchPage.mockResolvedValue({
      finalUrl: watch.url,
      contentType: "text/plain",
      text: "Stable content",
      hash: "stable-hash",
    });

    const result = await runOfficialSourceWatch(MONDAY);

    expect(result.recovered).toBe(1);
    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.consecutiveFailures).toBe(0);
    expect(stored.lastError).toBeNull();
    expect(stored.lastChangedAt?.toISOString()).toBe(changedAt.toISOString());
    expect(stored.reviewedAt?.toISOString()).toBe(reviewedAt.toISOString());
    expect(stored.lastExcerpt).toBe("Added: Stable content");
  });

  it("changed content stores a capped excerpt and one idempotent owner message", async () => {
    const watch = await createWatch("changed", {
      lastHash: "before-hash",
      lastText: "Header\nOld paragraph\nFooter",
    });
    mocks.fetchPage.mockResolvedValue({
      finalUrl: watch.url,
      contentType: "text/html",
      text: "Header\nNew paragraph\nFooter",
      hash: "after-hash",
    });

    const first = await runOfficialSourceWatch(MONDAY);
    const second = await runOfficialSourceWatch(MONDAY);

    expect(first.changed).toBe(1);
    expect(second.changed).toBe(0);
    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.lastExcerpt).toContain("Added: New paragraph");
    expect(stored.lastExcerpt).toContain("Removed: Old paragraph");
    expect(stored.lastExcerpt!.length).toBeLessThanOrEqual(700);
    expect(stored.reviewedAt).toBeNull();

    const deliveries = await prisma.messageDelivery.findMany({
      where: { subjectType: "OfficialSourceWatch", subjectId: watch.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.idempotencyKey).toBe(
      `tax-source-changed:${watch.id}:after-hash`,
    );
    expect(deliveries[0]?.templateKey).toBe("tax-source-changed");
    expect(deliveries[0]?.state).toBe("NOT_SENT");
    expect(deliveries[0]?.attempts).toBeGreaterThan(1);

    const overview = await getExceptionOverview();
    const item = overview.items.find((entry) =>
      entry.title.includes(watch.label),
    );
    expect(item?.title).toBe(
      `Colorado updated ${watch.label} — here is what's new`,
    );
    expect(item?.sourceHref).toBe(watch.url);
  });

  it("three consecutive failures create a persistent page-moved Today item", async () => {
    const watch = await createWatch("failed", {
      lastHash: "good-hash",
      lastText: "Last good content",
    });
    mocks.fetchPage.mockRejectedValue(new Error(`fetch failed for ${watch.url}`));

    await runOfficialSourceWatch(MONDAY);
    await runOfficialSourceWatch(MONDAY);
    await runOfficialSourceWatch(MONDAY);

    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.consecutiveFailures).toBe(3);
    expect(stored.lastHash).toBe("good-hash");
    expect(stored.lastText).toBe("Last good content");
    expect(stored.lastError).not.toContain(watch.url);

    const overview = await getExceptionOverview();
    expect(
      overview.items.some(
        (item) =>
          item.title ===
          `We couldn't check ${watch.label} — the page may have moved`,
      ),
    ).toBe(true);
  });

  it("successful recovery clears only the failure alert", async () => {
    const changedAt = new Date("2026-09-28T18:00:00.000Z");
    const watch = await createWatch("recover", {
      lastHash: "good-hash",
      lastText: "Good content",
      lastExcerpt: "Added: Important page update",
      lastChangedAt: changedAt,
      reviewedAt: null,
      consecutiveFailures: 3,
    });
    mocks.fetchPage.mockResolvedValue({
      finalUrl: watch.url,
      contentType: "text/plain",
      text: "Good content",
      hash: "good-hash",
    });

    const result = await runOfficialSourceWatch(MONDAY);
    expect(result.recovered).toBe(1);

    const overview = await getExceptionOverview();
    expect(
      overview.items.some((item) =>
        item.title.startsWith("We couldn't check"),
      ),
    ).toBe(false);
    expect(
      overview.items.some(
        (item) =>
          item.title ===
          `Colorado updated ${watch.label} — here is what's new`,
      ),
    ).toBe(true);
  });

  it("owner acknowledgement records reviewedAt and audit evidence", async () => {
    const watch = await createWatch("ack", {
      lastHash: "hash",
      lastText: "content",
      lastExcerpt: "Added: something",
      lastChangedAt: new Date("2026-10-05T18:00:00.000Z"),
    });

    expect(
      await acknowledgeOfficialSourceChange(
        watch.id,
        `hash:${new Date("2026-10-05T18:00:00.000Z").getTime()}`,
        new Date("2026-10-05T19:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      await acknowledgeOfficialSourceChange(
        watch.id,
        `hash:${new Date("2026-10-05T18:00:00.000Z").getTime()}`,
      ),
    ).toBe(false);

    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.reviewedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "tax.official_source_change_reviewed",
        entityType: "OfficialSourceWatch",
        entityId: watch.id,
      },
    });
    expect(audit.userId).toBe(ownerId);
  });

  it("stale acknowledgement cannot clear a newer unseen change", async () => {
    const watch = await createWatch("stale-ack", {
      lastHash: "old-hash",
      lastText: "old content",
      lastExcerpt: "Added: old change",
      lastChangedAt: new Date("2026-10-05T18:00:00.000Z"),
    });

    await prisma.officialSourceWatch.update({
      where: { id: watch.id },
      data: {
        lastHash: "new-hash",
        lastText: "new content",
        lastExcerpt: "Added: newer unseen change",
        lastChangedAt: new Date("2026-10-05T18:30:00.000Z"),
        reviewedAt: null,
      },
    });

    expect(
      await acknowledgeOfficialSourceChange(
        watch.id,
        `old-hash:${new Date("2026-10-05T18:00:00.000Z").getTime()}`,
        new Date("2026-10-05T19:00:00.000Z"),
      ),
    ).toBe(false);

    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.reviewedAt).toBeNull();
    expect(stored.lastHash).toBe("new-hash");
    expect(
      await prisma.auditLog.count({
        where: {
          action: "tax.official_source_change_reviewed",
          entityType: "OfficialSourceWatch",
          entityId: watch.id,
        },
      }),
    ).toBe(0);
  });

  it("continues to later sources when a listed watch disappears before persistence", async () => {
    const disappearing = await createWatch("a-disappearing");
    const survivor = await createWatch("z-survivor");

    mocks.fetchPage.mockImplementation(async (sourceUrl: string) => {
      if (sourceUrl === disappearing.url) {
        await prisma.officialSourceWatch.delete({
          where: { id: disappearing.id },
        });
        return {
          finalUrl: sourceUrl,
          contentType: "text/plain",
          text: "gone before persistence",
          hash: "gone-hash",
        };
      }
      return {
        finalUrl: sourceUrl,
        contentType: "text/plain",
        text: "survivor content",
        hash: "survivor-hash",
      };
    });

    const result = await runOfficialSourceWatch(MONDAY);

    expect(result.checked).toBe(2);
    expect(result.failed).toBe(1);
    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: survivor.id },
    });
    expect(stored.lastHash).toBe("survivor-hash");
    expect(stored.lastText).toBe("survivor content");
  });

  it("inactive sources are never fetched or surfaced", async () => {
    const watch = await createWatch("inactive", {
      active: false,
      lastHash: "hash",
      lastText: "content",
      lastExcerpt: "Added: hidden",
      lastChangedAt: new Date("2026-10-05T18:00:00.000Z"),
      consecutiveFailures: 5,
    });

    await runOfficialSourceWatch(MONDAY);
    expect(mocks.fetchPage).not.toHaveBeenCalledWith(watch.url);

    const overview = await getExceptionOverview();
    expect(
      overview.items.some((item) => item.title.includes(watch.label)),
    ).toBe(false);
  });

  it("TFA-3: a parser watch is read daily inside its window and stores readings", async () => {
    const watch = await createWatch("interest-window", { parserKey: "CO_INTEREST" });
    const hashOnly = await createWatch("hash-only-wednesday");
    const fixture = readFileSync(
      path.join(__dirname, "fixtures", "official-pages", "co-interest.html"), "utf8",
    );
    mocks.fetchPage.mockImplementation(async (sourceUrl: string) => ({
      finalUrl: sourceUrl,
      contentType: "text/html" as const,
      text: sourceUrl === watch.url ? fixture : "Other page",
      hash: sourceUrl === watch.url ? "interest-hash" : "other-hash",
    }));

    // Wednesday Nov 4, 2026: inside the Nov 1 - Jan 31 interest window,
    // not a Monday, so the hash-only watch is not due.
    const wednesday = new Date("2026-11-04T18:00:00.000Z");
    const result = await runOfficialSourceWatch(wednesday);

    expect(result.checked).toBe(1);
    expect(result.observations).toBe(4);
    expect(mocks.fetchPage).not.toHaveBeenCalledWith(hashOnly.url);
    const stored = await prisma.legalRuleObservation.findMany({
      where: { watchId: watch.id },
      select: { value: true, effectiveFrom: true },
    });
    expect(stored).toHaveLength(4);
    expect(stored.some((row) => {
      const value = row.value as { regular?: number; discounted?: number };
      return value.regular === 11 && value.discounted === 8;
    })).toBe(true);
  });

  it("TFA-3: a parser watch outside its window is not read on a weekday", async () => {
    await createWatch("interest-outside", { parserKey: "CO_INTEREST" });
    // Wednesday Mar 4, 2026: outside Nov 1 - Jan 31 and not a Monday.
    const result = await runOfficialSourceWatch(new Date("2026-03-04T18:00:00.000Z"));
    expect(result.checked).toBe(0);
    expect(mocks.fetchPage).not.toHaveBeenCalled();
  });

  it("TFA-3: an unreadable parser page records a failure and stores no reading", async () => {
    const watch = await createWatch("rdf-broken", { parserKey: "RDF_RATES" });
    mocks.fetchPage.mockResolvedValue({
      finalUrl: watch.url,
      contentType: "text/html",
      text: "<html><body><p>The page was redesigned.</p></body></html>",
      hash: "broken-hash",
    });

    const result = await runOfficialSourceWatch(MONDAY);

    expect(result.failed).toBe(1);
    const stored = await prisma.officialSourceWatch.findUniqueOrThrow({
      where: { id: watch.id },
    });
    expect(stored.lastError).toContain("Couldn't read the page");
    expect(stored.consecutiveFailures).toBe(1);
    expect(
      await prisma.legalRuleObservation.count({ where: { watchId: watch.id } }),
    ).toBe(0);
  });

  it("TFA-3: the owner watch switch off means no fetches at all", async () => {
    await createWatch("switch-off");
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { watchOfficialTaxPages: false },
    });
    try {
      const result = await runOfficialSourceWatch(MONDAY);
      expect(result.checked).toBe(0);
      expect(mocks.fetchPage).not.toHaveBeenCalled();
    } finally {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { watchOfficialTaxPages: true },
      });
    }
  });

  it("TFA-3: a Greeley reading goes through the rate review path, never a rule observation", async () => {
    const jurisdiction = await prisma.taxJurisdiction.create({
      data: {
        code: `GREELEY-TFA3-${tag}`,
        name: `City of Greeley ${tag}`,
        level: "CITY",
        administration: "SELF_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
    try {
      const watch = await createWatch("greeley", { parserKey: "GREELEY_RATE" });
      const fixture = readFileSync(
        path.join(__dirname, "fixtures", "official-pages", "greeley-rate-dated.html"), "utf8",
      );
      mocks.fetchPage.mockResolvedValue({
        finalUrl: watch.url,
        contentType: "text/html",
        text: fixture,
        hash: "greeley-hash",
      });

      const monday1 = new Date("2026-10-26T18:00:00.000Z");
      await runOfficialSourceWatch(monday1);
      expect(
        await prisma.taxRateObservation.count({
          where: { jurisdictionId: jurisdiction.id, rateMilliPercent: 4710 },
        }),
      ).toBe(1);
      expect(
        await prisma.legalRuleObservation.count({ where: { watchId: watch.id } }),
      ).toBe(0);

      // Read the same way on a second day: the review item appears.
      const monday2 = new Date("2026-11-02T18:00:00.000Z");
      await runOfficialSourceWatch(monday2);
      const attention = await listOfficialRateAttention(monday2);
      expect(attention.some((item) =>
        item.kind === "REVIEW_REQUIRED" && item.jurisdictionName === jurisdiction.name)).toBe(true);
    } finally {
      await prisma.taxRateObservation.deleteMany({
        where: { jurisdictionId: jurisdiction.id },
      });
      await prisma.taxJurisdiction.delete({ where: { id: jurisdiction.id } });
    }
  });

  it("December CPA reminder is once per Colorado year", async () => {
    const first = new Date("2099-12-01T18:00:00.000Z");
    const later = new Date("2099-12-20T18:00:00.000Z");

    await runOfficialSourceWatch(first);
    await runOfficialSourceWatch(later);

    const tasks = await prisma.staffTask.findMany({
      where: { sourceKey: "tax-cpa-annual-review:2099" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.note).toBe(
      "Ask your CPA whether anything in Colorado sales tax changes on January 1 for you",
    );
    expect(tasks[0]?.assigneeUserId).toBe(ownerId);
  });
});
