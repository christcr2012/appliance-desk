import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DECISION_SUBJECTS } from "@/domains/decisions/registry";
import { applyStartingValues } from "@/domains/decisions/starting-values";
import { listStartingValuesAttention, markStartingValuesReviewed } from "@/domains/decisions/attention";
import { getTaxabilityRulesAsOf } from "@/domains/tax/locations";
import { addBusinessDays, businessDateKey, businessDateFromKey } from "@/lib/business-date";

// DEC-2 on real PostgreSQL (throwaway CI database only). The run needs exactly one active owner, so this temporarily
// archives any other owners and restores them. It changes three settings and restores them; every record the run
// writes is removed again. Runs in the serial project because the nightly run looks at every question.
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname)
  && db.pathname === "/appliance_desk_test";

async function withOneOwner(run: (ownerId: string) => Promise<void>) {
  const started = new Date();
  const key = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.create({ data: {
    email: `owner-${key}@starting-values.example.test`, name: "Starting values owner", role: "OWNER",
    passwordHash: "test-only",
  } });
  const others = await prisma.user.findMany({
    where: { role: "OWNER", archivedAt: null, id: { not: owner.id } }, select: { id: true },
  });
  await prisma.user.updateMany({ where: { id: { in: others.map((row) => row.id) } }, data: { archivedAt: started } });
  const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  // Another real-database test that runs the nightly job leaves system-made starting-value records behind in this
  // shared throwaway database; start from none so "once per question" is judged only on this test's own run.
  const leftovers = await prisma.decisionRecord.findMany({
    where: { via: "MIGRATION", answeredByUserId: null }, select: { id: true } });
  await prisma.decisionScheduledChange.deleteMany({ where: { decisionRecordId: { in: leftovers.map((row) => row.id) } } });
  await prisma.decisionRecord.deleteMany({ where: { id: { in: leftovers.map((row) => row.id) } } });
  try {
    await run(owner.id);
  } finally {
    const created = { createdAt: { gte: started } };
    await prisma.decisionScheduledChange.deleteMany({ where: created });
    await prisma.decisionRecord.deleteMany({ where: created });
    await prisma.auditLog.deleteMany({ where: { userId: owner.id } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      lateFeeFlatCents: settings.lateFeeFlatCents, trustedDeviceDays: settings.trustedDeviceDays,
      decisionsReviewedAt: settings.decisionsReviewedAt,
    } });
    await prisma.user.updateMany({ where: { id: { in: others.map((row) => row.id) } }, data: { archivedAt: null } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
  }
}

const records = () => prisma.decisionRecord.findMany({ orderBy: { createdAt: "asc" } });

describe.skipIf(!enabled)("DEC-2 researched starting values on PostgreSQL", () => {
  it("applies each value once from the next business day, records it without naming a person, and shows one To do item", () =>
    withOneOwner(async (ownerId) => {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
        lateFeeFlatCents: 0, trustedDeviceDays: 30, decisionsReviewedAt: null } });
      const before = await records();
      const result = await applyStartingValues();

      expect(result.confirmed).toContain("LATE-FEE-AMOUNT");
      expect(result.applied).toContain("IN-33-ELECTION");
      // Every question with a value is either applied or skipped with a plain reason: nothing silently ignored.
      const withValue = DECISION_SUBJECTS.filter((subject) => subject.recommended && !before.some((r) => r.subjectId === subject.id));
      const accounted = new Set([...result.applied, ...result.confirmed, ...result.skipped.map((row) => row.id)]);
      for (const subject of withValue) expect(accounted.has(subject.id), subject.id).toBe(true);
      for (const skipped of result.skipped) expect(skipped.why.length, skipped.id).toBeGreaterThan(5);

      const written = (await records()).filter((row) => !before.some((old) => old.id === row.id));
      const fee = written.find((row) => row.subjectId === "LATE-FEE-AMOUNT")!;
      expect(fee).toMatchObject({ kind: "CONFIRMED", via: "MIGRATION", answeredByUserId: null, value: 500 });
      const election = written.find((row) => row.subjectId === "IN-33-ELECTION")!;
      expect(election).toMatchObject({ kind: "STARTING_VALUE_APPLIED", via: "MIGRATION", answeredByUserId: null,
        value: "PAY_ON_ACQUISITION" });
      expect(JSON.stringify(election.sources)).toContain("tax.colorado.gov");

      // It starts tomorrow (Denver), never today: nothing already billed changes.
      const tomorrow = businessDateKey(addBusinessDays(new Date(), 1));
      expect(businessDateKey(fee.effectiveFrom!)).toBe(tomorrow);
      const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
      expect(settings.lateFeeFlatCents).toBe(0); // not yet: the scheduled change applies on its date
      const scheduled = await prisma.decisionScheduledChange.findFirstOrThrow({ where: { subjectId: "LATE-FEE-AMOUNT" } });
      expect(scheduled).toMatchObject({ value: 500, appliedAt: null, provisional: false });

      // One To do item for all of them, until the owner marks them reviewed.
      const todo = await listStartingValuesAttention();
      expect(todo.total).toBe(1);
      expect(todo.rows[0]).toMatchObject({ category: "DECISIONS_STARTING_VALUES", href: "/desk/settings/decisions?state=starting_value" });
      expect(todo.rows[0]!.title).toMatch(/starting values? (is|are) now in use/);
      await markStartingValuesReviewed(ownerId);
      expect((await listStartingValuesAttention()).total).toBe(0);
    }));

  it("a second run does nothing", () => withOneOwner(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeFlatCents: 0 } });
    await applyStartingValues();
    const afterFirst = (await records()).length;
    const again = await applyStartingValues();
    expect(again.applied).toEqual([]);
    expect(again.confirmed).toEqual([]);
    expect((await records()).length).toBe(afterFirst);
  }));

  it("never overwrites a setting that was already changed", () => withOneOwner(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeFlatCents: 1000, trustedDeviceDays: 60 } });
    const result = await applyStartingValues();
    expect(result.skipped).toEqual(expect.arrayContaining([
      { id: "LATE-FEE-AMOUNT", why: "Already set by you" },
      { id: "TRUSTED-DEVICE-DAYS", why: "Already set by you" },
    ]));
    expect((await records()).filter((row) => ["LATE-FEE-AMOUNT", "TRUSTED-DEVICE-DAYS"].includes(row.subjectId))).toEqual([]);
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(settings).toMatchObject({ lateFeeFlatCents: 1000, trustedDeviceDays: 60 });
  }));

  it("leaves signed agreements and issued invoices exactly as they were", () => withOneOwner(async () => {
    const agreements = await prisma.rentalAgreement.findMany({ orderBy: { id: "asc" } });
    const invoices = await prisma.invoice.findMany({ orderBy: { id: "asc" }, include: { lineItems: { orderBy: { id: "asc" } } } });
    expect(agreements.length).toBeGreaterThan(0);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeFlatCents: 0 } });
    await applyStartingValues();
    // Values start on their own date through the scheduled-change path, so the run itself touches no agreement or bill.
    expect(await prisma.rentalAgreement.findMany({ orderBy: { id: "asc" } })).toEqual(agreements);
    expect(await prisma.invoice.findMany({ orderBy: { id: "asc" }, include: { lineItems: { orderBy: { id: "asc" } } } })).toEqual(invoices);
  }));

  it("a tax starting value takes effect at the start of its date and is marked 'not confirmed' (provisional)", () => withOneOwner(async () => {
    await applyStartingValues();
    const scheduled = await prisma.decisionScheduledChange.findFirst({ where: { subjectId: "IN-34-LATE-PAYMENT-FEE-STATE" } });
    if (!scheduled) return; // already set by the CPA or owner in this database
    expect(scheduled).toMatchObject({ value: "EXEMPT", provisional: true });
    const day = businessDateKey(scheduled.effectiveFrom);
    const startOfDay = businessDateFromKey(day)!;
    const before = (await getTaxabilityRulesAsOf(prisma, new Date(startOfDay.getTime() - 60_000)))
      .find((row) => row.jurisdictionId === null && row.category === "LATE_PAYMENT_FEE");
    const onDay = (await getTaxabilityRulesAsOf(prisma, startOfDay))
      .find((row) => row.jurisdictionId === null && row.category === "LATE_PAYMENT_FEE");
    expect(onDay).toMatchObject({ taxability: "EXEMPT", provisional: true });
    expect(before?.provisional === true && before.taxability === "EXEMPT").toBe(false);
  }));

  it("with more than one active owner nothing is applied", () => withOneOwner(async () => {
    const second = await prisma.user.create({ data: {
      email: `owner2-${randomUUID().replaceAll("-", "")}@starting-values.example.test`, name: "Second owner",
      role: "OWNER", passwordHash: "test-only" } });
    try {
      const before = (await records()).length;
      expect(await applyStartingValues()).toEqual({ applied: [], confirmed: [], skipped: [] });
      expect((await records()).length).toBe(before);
    } finally {
      await prisma.user.delete({ where: { id: second.id } });
    }
  }));
});
