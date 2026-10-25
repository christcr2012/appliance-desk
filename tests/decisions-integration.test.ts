import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  applyAnswers,
  applyDueDecisionChanges,
  applyStartingValue,
  changeDecision,
  confirmDecision,
  getDecision,
  listDecisions,
  previewAnswers,
  recordProfessionalAnswer,
  sendToProfessional,
} from "@/domains/decisions";
import { getTaxabilityRulesAsOf } from "@/domains/tax/locations";
import { saveTaxabilityCell } from "@/domains/tax/setup";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

// Real PostgreSQL (throwaway CI database only). Changes the shared settings row and the all-state default rule for
// "other charges", and restores both, so it runs in the serial project (vitest.config.mts).
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname)
  && db.pathname === "/appliance_desk_test";

const SUBJECT = "IN-34-OTHER-CHARGE-STATE";
const RDF_SUBJECT = "IN-37-RDF-OWED";

function dayKey(offset: number) {
  const [y, m, d] = businessDateKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + offset)).toISOString().slice(0, 10);
}
const noonOf = (key: string) => new Date(businessDateFromKey(key)!.getTime() + 12 * 60 * 60 * 1000);

async function people(run: (ids: { owner: string; admin: string; staff: string }) => Promise<void>) {
  const key = randomUUID().replaceAll("-", "");
  const make = (role: "OWNER" | "ADMIN" | "STAFF") => prisma.user.create({ data: {
    email: `${role.toLowerCase()}-${key}@decisions.example.test`, name: `Decisions ${role}`, role,
    passwordHash: "test-only",
  } });
  const [owner, admin, staff] = [await make("OWNER"), await make("ADMIN"), await make("STAFF")];
  const ids = [owner.id, admin.id, staff.id];
  const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const rule = await prisma.taxabilityRule.findFirst({ where: { jurisdictionId: null, category: "OTHER_CHARGE" } });
  const versionIds = (await prisma.taxabilityRuleVersion.findMany({
    where: { jurisdictionId: null, category: "OTHER_CHARGE" }, select: { id: true },
  })).map((row) => row.id);
  try {
    await run({ owner: owner.id, admin: admin.id, staff: staff.id });
  } finally {
    await prisma.decisionScheduledChange.deleteMany({ where: { subjectId: { in: [SUBJECT, RDF_SUBJECT] } } });
    await prisma.decisionRecord.deleteMany({ where: { answeredByUserId: { in: ids } } });
    await prisma.taxabilityRuleVersion.deleteMany({
      where: { jurisdictionId: null, category: "OTHER_CHARGE", id: { notIn: versionIds } },
    });
    if (rule) {
      await prisma.taxabilityRule.update({ where: { id: rule.id }, data: {
        taxability: rule.taxability, reason: rule.reason, cpaConfirmedOn: rule.cpaConfirmedOn,
        updatedByUserId: rule.updatedByUserId, provisional: rule.provisional,
        provisionalReason: rule.provisionalReason, provisionalSources: rule.provisionalSources ?? Prisma.DbNull,
      } });
    } else {
      await prisma.taxabilityRule.deleteMany({ where: { jurisdictionId: null, category: "OTHER_CHARGE" } });
    }
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      retailDeliveryFeeDecision: settings.retailDeliveryFeeDecision,
    } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function otherChargeOn(at: Date) {
  return (await getTaxabilityRulesAsOf(prisma, at))
    .find((row) => row.jurisdictionId === null && row.category === "OTHER_CHARGE");
}

describe.skipIf(!enabled)("DEC-1a Decisions & reviews on PostgreSQL", () => {
  it("lets the owner act, admins only read, and refuses staff", () => people(async ({ owner, admin, staff }) => {
    const cards = await listDecisions(admin);
    expect(cards.map((card) => card.id)).toContain(SUBJECT);
    await expect(listDecisions(staff)).rejects.toThrow(/no longer has access/);
    await expect(changeDecision(admin, RDF_SUBJECT, "NOT_LIABLE", null)).rejects.toThrow(/no longer has access/);
    await expect(sendToProfessional(staff, RDF_SUBJECT, "CPA")).rejects.toThrow(/no longer has access/);
    expect(await prisma.decisionRecord.count({ where: { answeredByUserId: { in: [admin, staff] } } })).toBe(0);

    const started = Date.now();
    await changeDecision(owner, RDF_SUBJECT, "NOT_LIABLE", null, "Synthetic test answer");
    // The decision's save runs inside the decision's own transaction with the settings row already locked.
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).retailDeliveryFeeDecision)
      .toBe("NOT_LIABLE");
    const card = await getDecision(owner, RDF_SUBJECT);
    expect(card).toMatchObject({ state: "CONFIRMED", current: { value: "NOT_LIABLE" } });
    expect(card.last).toMatchObject({ kind: "CHANGED", previousValue: expect.anything(), explanation: "Synthetic test answer" });
    expect(await prisma.auditLog.count({ where: { userId: owner, action: "decision.changed" } })).toBe(1);

    await expect(changeDecision(owner, RDF_SUBJECT, "COLLECT", dayKey(-1)))
      .rejects.toThrow("A change can't apply to the past — signed and billed history stays as it was.");
    await expect(confirmDecision(owner, RDF_SUBJECT, "COLLECT")).rejects.toThrow(/changed since you opened it/);

    await sendToProfessional(owner, RDF_SUBJECT, "CPA");
    expect((await getDecision(admin, RDF_SUBJECT))).toMatchObject({ state: "WITH_PROFESSIONAL", audience: "CPA" });
    await recordProfessionalAnswer(owner, RDF_SUBJECT, { value: null, otherText: "Ask again next July",
      effectiveFrom: null, professionalName: "Pat Example", professionalFirm: "Example CPAs", answeredOn: dayKey(0) },
    "SCREEN");
    const other = await getDecision(owner, RDF_SUBJECT);
    expect(other).toMatchObject({ needsAppChange: true, current: { value: "NOT_LIABLE" } });
  }));

  it("runs a provisional tax value, confirms it, and keeps the history", () => people(async ({ owner }) => {
    await applyStartingValue(owner, SUBJECT, { value: "TAXABLE", effectiveFrom: null,
      why: "Synthetic starting value for the test",
      sources: [{ title: "Colorado DOR leases", url: "https://tax.colorado.gov/sales-use-tax-topics-leases",
        checkedOn: "2026-10-25" }] });
    const provisional = await prisma.taxabilityRule.findFirstOrThrow({
      where: { jurisdictionId: null, category: "OTHER_CHARGE" } });
    expect(provisional).toMatchObject({ taxability: "TAXABLE", provisional: true, cpaConfirmedOn: null });
    expect(await otherChargeOn(new Date())).toMatchObject({ taxability: "TAXABLE", provisional: true });
    expect((await getDecision(owner, SUBJECT)).last).toMatchObject({ kind: "STARTING_VALUE_APPLIED",
      sources: [expect.objectContaining({ checkedOn: "2026-10-25" })] });

    await confirmDecision(owner, SUBJECT, "TAXABLE");
    const confirmed = await prisma.taxabilityRule.findFirstOrThrow({
      where: { jurisdictionId: null, category: "OTHER_CHARGE" } });
    expect(confirmed).toMatchObject({ taxability: "TAXABLE", provisional: false });
    expect(confirmed.cpaConfirmedOn).not.toBeNull();
    expect(confirmed.reason).toMatch(/Confirmed by the owner/);
    const versions = await prisma.taxabilityRuleVersion.findMany({
      where: { jurisdictionId: null, category: "OTHER_CHARGE" }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
    expect(versions.map((row) => row.provisional).slice(-2)).toEqual([true, false]);
    expect((await getDecision(owner, SUBJECT))).toMatchObject({ state: "CONFIRMED" });
  }));

  it("keeps a later change waiting, taxes by date before and after the nightly run, and applies it once",
    () => people(async ({ owner }) => {
      await applyStartingValue(owner, SUBJECT, { value: "TAXABLE", effectiveFrom: null, why: "Synthetic", sources: [] });
      await confirmDecision(owner, SUBJECT, "TAXABLE");
      await changeDecision(owner, SUBJECT, "EXEMPT", dayKey(1));
      expect((await prisma.taxabilityRule.findFirstOrThrow({ where: { jurisdictionId: null, category: "OTHER_CHARGE" } }))
        .taxability).toBe("TAXABLE");
      expect((await otherChargeOn(noonOf(dayKey(0))))?.taxability).toBe("TAXABLE");
      // Tomorrow's bill already uses tomorrow's rule, before the nightly run.
      expect((await otherChargeOn(noonOf(dayKey(1))))?.taxability).toBe("EXEMPT");
      expect((await getDecision(owner, SUBJECT)).pending).toMatchObject({ value: "EXEMPT" });

      // A newer decision cancels the one still waiting.
      await changeDecision(owner, SUBJECT, "EXEMPT", dayKey(2));
      const waiting = await prisma.decisionScheduledChange.findMany({ where: { subjectId: SUBJECT } });
      expect(waiting.filter((row) => !row.cancelledAt && !row.appliedAt)).toHaveLength(1);
      expect((await otherChargeOn(noonOf(dayKey(1))))?.taxability).toBe("TAXABLE");

      const first = await applyDueDecisionChanges(noonOf(dayKey(3)));
      expect(first.failed).toBe(0);
      expect(first.applied).toBeGreaterThanOrEqual(1);
      const again = await applyDueDecisionChanges(noonOf(dayKey(3)));
      expect(again.applied).toBe(0);
      const applied = await prisma.decisionScheduledChange.findFirstOrThrow({
        where: { subjectId: SUBJECT, cancelledAt: null } });
      expect(applied.appliedAt).not.toBeNull();
      expect((await prisma.taxabilityRule.findFirstOrThrow({ where: { jurisdictionId: null, category: "OTHER_CHARGE" } }))
        .taxability).toBe("EXEMPT");
      expect(await prisma.taxabilityRuleVersion.count({ where: { jurisdictionId: null, category: "OTHER_CHARGE",
        taxability: "EXEMPT", effectiveFrom: businessDateFromKey(dayKey(2))! } })).toBe(1);
      // After the nightly run: the old date keeps the old rule, the new date has the new one.
      expect((await otherChargeOn(noonOf(dayKey(0))))?.taxability).toBe("TAXABLE");
      expect((await otherChargeOn(noonOf(dayKey(2))))?.taxability).toBe("EXEMPT");
    }));

  it("applies a completed form only exactly as previewed", () => people(async ({ owner }) => {
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
      process.env.BETTER_AUTH_SECRET = "ci-test-secret-not-for-production-use-only";
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { retailDeliveryFeeDecision: "UNDECIDED" } });
    const answers = [{ code: `DQ-${RDF_SUBJECT}`, option: "NOT_LIABLE", answeredBy: "Pat Example", firm: "Example CPAs",
      answeredOn: dayKey(0), explanation: "No prior-year Colorado retail sales." }];
    const { preview, confirmToken } = await previewAnswers(owner, answers);
    expect(preview).toEqual([expect.objectContaining({ code: RDF_SUBJECT, status: "CHANGE" })]);
    await expect(applyAnswers(owner, [{ ...answers[0]!, option: "COLLECT" }], confirmToken))
      .rejects.toThrow(/changed since the preview/);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).retailDeliveryFeeDecision)
      .toBe("UNDECIDED");
    const result = await applyAnswers(owner, answers, confirmToken);
    expect(result).toMatchObject({ applied: 1, skipped: 0 });
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).retailDeliveryFeeDecision)
      .toBe("NOT_LIABLE");
    expect((await getDecision(owner, RDF_SUBJECT)).last).toMatchObject({ kind: "PROFESSIONAL_ANSWER", via: "IMPORT",
      professionalName: "Pat Example", professionalFirm: "Example CPAs" });
    // One preview applies once.
    await expect(applyAnswers(owner, answers, confirmToken)).rejects.toThrow(/already applied/);
    expect(await prisma.decisionRecord.count({ where: { subjectId: RDF_SUBJECT, kind: "PROFESSIONAL_ANSWER",
      answeredByUserId: owner } })).toBe(1);
  }));

  it("a save on the tax rule's own screen cancels a decision still waiting for that rule", () =>
    people(async ({ owner }) => {
      await changeDecision(owner, SUBJECT, "EXEMPT", dayKey(1));
      const waiting = await prisma.decisionScheduledChange.findFirstOrThrow({
        where: { subjectId: SUBJECT, appliedAt: null, cancelledAt: null } });
      await saveTaxabilityCell(owner, { jurisdictionId: null, category: "OTHER_CHARGE", taxability: "TAXABLE",
        cpaConfirmedOn: new Date(), reason: "Synthetic newer save on the tax screen" });
      expect((await prisma.decisionScheduledChange.findUniqueOrThrow({ where: { id: waiting.id } })).cancelledAt)
        .not.toBeNull();
      expect(await prisma.auditLog.count({ where: { action: "decision.scheduled_cancelled", entityId: waiting.id } }))
        .toBe(1);
      // The older waiting value never overwrites the newer save.
      await applyDueDecisionChanges(noonOf(dayKey(2)));
      expect((await prisma.taxabilityRule.findFirstOrThrow({ where: { jurisdictionId: null, category: "OTHER_CHARGE" } }))
        .taxability).toBe("TAXABLE");
      expect((await otherChargeOn(noonOf(dayKey(2))))?.taxability).toBe("TAXABLE");
    }));

  it("cancels, with a To do, a waiting change whose decider lost owner access", () =>
    people(async ({ owner }) => {
      await changeDecision(owner, RDF_SUBJECT, "COLLECT", dayKey(1));
      const waiting = await prisma.decisionScheduledChange.findFirstOrThrow({
        where: { subjectId: RDF_SUBJECT, appliedAt: null, cancelledAt: null } });
      await prisma.user.update({ where: { id: owner }, data: { archivedAt: new Date() } });
      try {
        const result = await applyDueDecisionChanges(noonOf(dayKey(2)));
        expect(result.failed).toBe(0);
        expect(result.cancelled).toBeGreaterThanOrEqual(1);
        expect((await prisma.decisionScheduledChange.findUniqueOrThrow({ where: { id: waiting.id } })).cancelledAt)
          .not.toBeNull();
        expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } }))
          .retailDeliveryFeeDecision).not.toBe("COLLECT");
        const todo = await prisma.staffTask.findUnique({ where: { sourceKey: `decision-cancelled:${waiting.id}` } });
        const activeOwner = await prisma.user.findFirst({ where: { role: "OWNER", archivedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        if (activeOwner) expect(todo?.assigneeUserId).toBe(activeOwner.id);
        // A second night does nothing more.
        expect((await applyDueDecisionChanges(noonOf(dayKey(2)))).cancelled).toBe(0);
      } finally {
        const task = await prisma.staffTask.findUnique({ where: { sourceKey: `decision-cancelled:${waiting.id}` } });
        if (task) {
          await prisma.auditLog.deleteMany({ where: { entityType: "StaffTask", entityId: task.id } });
          await prisma.staffTask.delete({ where: { id: task.id } });
        }
        await prisma.auditLog.deleteMany({ where: { entityType: "DecisionScheduledChange", entityId: waiting.id } });
        await prisma.user.update({ where: { id: owner }, data: { archivedAt: null } });
      }
    }));
});
