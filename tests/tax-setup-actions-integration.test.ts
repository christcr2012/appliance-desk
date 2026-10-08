import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveTaxSettings, saveTaxFilingAccount, addRdfRate, addManualTaxRateVersion } from "@/domains/tax/setup";

const u = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && u.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(u.hostname);

async function isolated(fn: (owner: string, admin: string, before: Awaited<ReturnType<typeof settings>>) => Promise<void>) {
  const id = randomUUID().replaceAll("-", "");
  const owner = await prisma.user.create({ data: {
    email: id + "@taxsetup.test", role: "OWNER", name: "Owner",
    passwordHash: "test-only",
  } });
  const admin = await prisma.user.create({ data: {
    email: id + ".admin@taxsetup.test", role: "ADMIN", name: "Admin",
    passwordHash: "test-only",
  } });
  const before = await settings();
  try { await fn(owner.id, admin.id, before); }
  finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner.id, admin.id] } } });
    await prisma.retailDeliveryFeeRate.deleteMany({ where: { enteredByUserId: owner.id } });
    await prisma.taxFilingAccount.deleteMany({ where: { name: { startsWith: "T7A fixture " } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: {
      shortTermLeaseElection: before.shortTermLeaseElection,
      shortTermLeaseElectionNote: before.shortTermLeaseElectionNote,
      rdfHandling: before.rdfHandling,
      rdfThresholdCents: before.rdfThresholdCents,
      rdfCpaConfirmedOn: before.rdfCpaConfirmedOn,
      autoApplyOfficialRateChanges: before.autoApplyOfficialRateChanges,
      autoRateChangeMaxMilliPercent: before.autoRateChangeMaxMilliPercent,
      businessTaxAddress: before.businessTaxAddress ?? {},
    } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } });
  }
}
const settings = () => prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
const validSettings = (s: Awaited<ReturnType<typeof settings>>) => ({
  shortTermLeaseElection: s.shortTermLeaseElection,
  shortTermLeaseElectionNote: s.shortTermLeaseElectionNote,
  rdfHandling: s.rdfHandling,
  rdfThresholdCents: s.rdfThresholdCents,
  rdfCpaConfirmedOn: s.rdfCpaConfirmedOn,
  autoApplyOfficialRateChanges: s.autoApplyOfficialRateChanges,
  autoRateChangeMaxMilliPercent: s.autoRateChangeMaxMilliPercent,
  businessLocation: null,
});

describe.skipIf(!enabled)("T-7A tax settings (isolated PostgreSQL)", () => {
  it("ADMIN cannot change fee handling", async () => isolated(async (_owner, admin, before) => {
    await expect(saveTaxSettings(admin, { ...validSettings(before), rdfHandling: "PAY_MYSELF" }, before.updatedAt)).rejects.toThrow();
    expect((await settings()).rdfHandling).toBe(before.rdfHandling);
  }));

  it("owner stale-save conflict leaves first decision intact", async () => isolated(async (owner, _admin, before) => {
    await saveTaxSettings(owner, { ...validSettings(before), autoApplyOfficialRateChanges: false }, before.updatedAt);
    await expect(saveTaxSettings(owner, { ...validSettings(before), rdfHandling: "PAY_MYSELF" }, before.updatedAt)).rejects.toThrow(/changed/i);
    expect((await settings()).autoApplyOfficialRateChanges).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId: owner, action: "tax.setup.settings_updated" } })).toBe(1);
  }));

  it("missing official filing account answers stay visibly incomplete", async () => isolated(async (owner, admin) => {
    const details = {
      id: null, name: "T7A fixture " + randomUUID(),
      kind: "SALES_RETURN" as const, frequency: "MONTHLY" as const,
      basis: "UNDECIDED" as const, accountNumber: null, portalUrl: null,
      dueDayOfFollowingMonth: 20, firstPeriodStart: null,
      emailReminders: false, reminderDaysBefore: [7, 2], active: true, filingNotes: null,
    };
    await expect(saveTaxFilingAccount(admin, details, null)).rejects.toThrow();
    const { id } = await saveTaxFilingAccount(owner, details, null);
    const row = await prisma.taxFilingAccount.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ basis: "UNDECIDED", accountNumber: null, firstPeriodStart: null });
    await expect(saveTaxFilingAccount(owner, { ...details, id }, new Date("2020-01-01"))).rejects.toThrow(/changed/i);
  }));

  it("new July amount appends without rewriting a previously entered rate", async () => isolated(async (owner) => {
    const first = await prisma.retailDeliveryFeeRate.findFirst({ orderBy: { effectiveOn: "asc" } });
    const when = new Date("2035-07-01T06:00:00.000Z");
    const id = await addRdfRate(owner, { effectiveOn: when, amountCents: 42 });
    expect((await prisma.retailDeliveryFeeRate.findUniqueOrThrow({ where: { id } })).amountCents).toBe(42);
    if (first) expect((await prisma.retailDeliveryFeeRate.findUniqueOrThrow({
      where: { id: first.id },
    })).amountCents).toBe(first.amountCents);
    await expect(addRdfRate(owner, { effectiveOn: when, amountCents: 43 })).rejects.toThrow();
  }));
  it("manual jurisdiction rates append a version without replacing history", async () => isolated(async (owner) => {
    const code = "T7A-" + randomUUID().replaceAll("-", "");
    const jurisdiction = await prisma.taxJurisdiction.create({
      data: { code, name: "Synthetic test tax area", level: "STATE",
        administration: "STATE_COLLECTED", reviewStatus: "REVIEWED" },
    });
    try {
      const old = await prisma.taxRateVersion.create({ data: {
        jurisdictionId: jurisdiction.id, effectiveFrom: new Date("2035-01-01T07:00:00Z"),
        rateMilliPercent: 3000, source: "MANUAL",
      } });
      const id = await addManualTaxRateVersion(owner, {
        jurisdictionId: jurisdiction.id, effectiveFrom: new Date("2035-07-01T12:00:00Z"),
        rateMilliPercent: 3300, sourceNote: "Synthetic official notice",
      });
      const added = await prisma.taxRateVersion.findUniqueOrThrow({ where: { id } });
      expect(added.effectiveFrom).toEqual(new Date("2035-07-01T06:00:00Z"));
      expect(added.rateMilliPercent).toBe(3300);
      expect((await prisma.taxRateVersion.findUniqueOrThrow({ where: { id: old.id } })).rateMilliPercent).toBe(3000);
      await expect(addManualTaxRateVersion(owner, {
        jurisdictionId: jurisdiction.id, effectiveFrom: new Date("2035-06-01T12:00:00Z"),
        rateMilliPercent: 3400, sourceNote: "Backdate not allowed",
      })).rejects.toThrow(/follow the existing history/);
    } finally {
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: jurisdiction.id } });
      await prisma.taxJurisdiction.delete({ where: { id: jurisdiction.id } });
    }
  }));
});

