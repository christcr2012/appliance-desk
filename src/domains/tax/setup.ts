import { Prisma, RdfHandling, ShortTermLeaseElection, TaxFilingAccountKind, TaxFilingFrequency, TaxReportingBasis, Taxability, TaxChargeCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

function textField(value: string | null, max: number, name: string) {
  if (value !== null && (value.length > max || /[\r\n<>]/.test(value)))
    throw new Error("Invalid " + name + ".");
  return value?.trim() || null;
}
function cents(value: number, ceiling: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ceiling)
    throw new Error("Invalid " + label + " in integer cents.");
  return value;
}
function date(value: Date | null, label: string) {
  if (value && (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 2000))
    throw new Error("Invalid " + label + ".");
  return value;
}
function enumValue<T extends string>(value: T, values: Record<string, T>, name: string): T {
  if (!Object.values(values).includes(value)) throw new Error("Invalid " + name + ".");
  return value;
}

export type TaxSettingsInput = {
  shortTermLeaseElection: ShortTermLeaseElection;
  shortTermLeaseElectionNote: string | null;
  rdfHandling: RdfHandling;
  rdfThresholdCents: number;
  rdfCpaConfirmedOn: Date | null;
  autoApplyOfficialRateChanges: boolean;
  autoRateChangeMaxMilliPercent: number;
  businessLocation: { line1: string; city: string; state: string; zip: string } | null;
};

/** Owner-only, optimistic-concurrency protected, explicit whitelist. */
export async function saveTaxSettings(
  actorId: string, input: TaxSettingsInput, expectedUpdatedAt: Date,
): Promise<void> {
  date(expectedUpdatedAt, "settings version");
  const changed = {
    shortTermLeaseElection: enumValue(input.shortTermLeaseElection, ShortTermLeaseElection, "lease election"),
    shortTermLeaseElectionNote: textField(input.shortTermLeaseElectionNote, 500, "lease decision note"),
    rdfHandling: enumValue(input.rdfHandling, RdfHandling, "fee handling"),
    rdfThresholdCents: cents(input.rdfThresholdCents, 1_000_000_000_00, "delivery fee threshold"),
    rdfCpaConfirmedOn: date(input.rdfCpaConfirmedOn, "CPA date"),
    autoApplyOfficialRateChanges: input.autoApplyOfficialRateChanges === true,
    autoRateChangeMaxMilliPercent: cents(input.autoRateChangeMaxMilliPercent, 100_000, "automatic rate change ceiling"),
    businessTaxAddress: input.businessLocation ? {
      line1: textField(input.businessLocation.line1, 120, "business address") ?? "",
      city: textField(input.businessLocation.city, 80, "business city") ?? "",
      state: textField(input.businessLocation.state, 2, "business state") ?? "",
      zip: textField(input.businessLocation.zip, 12, "business ZIP") ?? "",
    } : {},
  };
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { updatedAt: true, shortTermLeaseElection: true, rdfHandling: true,
        rdfThresholdCents: true, rdfCpaConfirmedOn: true },
    });
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime())
      throw new Error("Settings changed in another session. Refresh before saving.");
    await tx.businessSettings.update({ where: { id: "singleton" }, data: changed });
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.setup.settings_updated",
        entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { leaseElection: before.shortTermLeaseElection, rdfHandling: before.rdfHandling,
          rdfThresholdCents: before.rdfThresholdCents, rdfCpaConfirmedOn: before.rdfCpaConfirmedOn?.toISOString() ?? null },
        newValue: { leaseElection: changed.shortTermLeaseElection, rdfHandling: changed.rdfHandling,
          rdfThresholdCents: changed.rdfThresholdCents,
          rdfCpaConfirmedOn: changed.rdfCpaConfirmedOn?.toISOString() ?? null } },
    });
  });
}

export type FilingAccountInput = {
  id: string | null;
  name: string;
  kind: TaxFilingAccountKind;
  frequency: TaxFilingFrequency;
  basis: TaxReportingBasis;
  accountNumber: string | null;
  portalUrl: string | null;
  dueDayOfFollowingMonth: number;
  firstPeriodStart: Date | null;
  emailReminders: boolean;
  reminderDaysBefore: number[];
  active: boolean;
  filingNotes: string | null;
};

export async function saveTaxFilingAccount(
  actorId: string, input: FilingAccountInput, expectedUpdatedAt: Date | null,
): Promise<{ id: string }> {
  const name = textField(input.name, 100, "filing account name");
  if (!name) throw new Error("Enter a filing account name.");
  const data = {
    name,
    kind: enumValue(input.kind, TaxFilingAccountKind, "filing kind"),
    frequency: enumValue(input.frequency, TaxFilingFrequency, "frequency"),
    basis: enumValue(input.basis, TaxReportingBasis, "basis"),
    accountNumber: textField(input.accountNumber, 100, "account number"),
    portalUrl: textField(input.portalUrl, 500, "filing website"),
    dueDayOfFollowingMonth: cents(input.dueDayOfFollowingMonth, 31, "due day"),
    firstPeriodStart: input.firstPeriodStart ? businessDateFromKey(businessDateKey(date(input.firstPeriodStart, "first filing period")!)) : null,
    emailReminders: input.emailReminders === true,
    reminderDaysBefore: [...input.reminderDaysBefore],
    active: input.active === true,
    filingNotes: textField(input.filingNotes, 1000, "filing notes"),
  };
  if (data.dueDayOfFollowingMonth < 1 ||
      data.reminderDaysBefore.length > 10 ||
      data.reminderDaysBefore.some(n => !Number.isSafeInteger(n) || n < 0 || n > 60))
    throw new Error("Invalid due-day or reminder configuration.");
  if (new Set(data.reminderDaysBefore).size !== data.reminderDaysBefore.length)
    throw new Error("Reminder days must not repeat.");
  if (data.portalUrl) {
    const parsed = new URL(data.portalUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error("Filing URL must be an HTTPS website without credentials.");
  }
  date(expectedUpdatedAt, "account version");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const same = await tx.taxFilingAccount.findMany({
      where: { kind: data.kind }, select: { id: true, name: true },
    });
    if (same.some(x => x.id !== input.id && x.name.toLowerCase() === name.toLowerCase()))
      throw new Error("A filing account with that name and kind already exists.");
    let id: string;
    if (input.id) {
      if (!expectedUpdatedAt) throw new Error("Missing account version. Refresh first.");
      await tx.$queryRaw`SELECT "id" FROM "TaxFilingAccount" WHERE "id" = ${input.id} FOR UPDATE`;
      const before = await tx.taxFilingAccount.findUniqueOrThrow({
        where: { id: input.id },
        select: { updatedAt: true, kind: true, _count: { select: { periods: true } } },
      });
      if (before.kind !== data.kind && before._count.periods > 0)
        throw new Error("Filing accounts with recorded returns cannot change return type.");
      if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime())
        throw new Error("Filing account changed in another session.");
      await tx.taxFilingAccount.update({ where: { id: input.id }, data });
      id = input.id;
    } else {
      if (expectedUpdatedAt) throw new Error("A new account cannot have an old version.");
      id = (await tx.taxFilingAccount.create({ data, select: { id: true } })).id;
    }
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.setup.filing_account_saved",
        entityType: "TaxFilingAccount", entityId: id,
        newValue: { name: data.name, kind: data.kind, frequency: data.frequency,
          basis: data.basis, firstPeriodStart: data.firstPeriodStart?.toISOString() ?? null,
          configured: Boolean(data.accountNumber && data.firstPeriodStart && data.basis !== "UNDECIDED") } },
    });
    return { id };
  });
}

export async function saveTaxabilityCell(
  actorId: string,
  input: { jurisdictionId: string; category: TaxChargeCategory; taxability: Taxability;
    cpaConfirmedOn: Date; reason: string },
): Promise<void> {
  enumValue(input.category, TaxChargeCategory, "tax category");
  enumValue(input.taxability, Taxability, "taxability");
  if (input.taxability === "UNDECIDED") throw new Error("The confirmed cell must be taxable or exempt.");
  date(input.cpaConfirmedOn, "CPA confirmation date");
  if (!input.cpaConfirmedOn) throw new Error("Taxability confirmation needs a CPA date.");
  const reason = textField(input.reason, 500, "CPA decision") ?? "";
  if (!reason) throw new Error("Explain the confirmed taxability decision.");
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "TaxJurisdiction" WHERE "id" = ${input.jurisdictionId} FOR UPDATE`;
    await tx.taxJurisdiction.findUniqueOrThrow({ where: { id: input.jurisdictionId } });
    const existing = await tx.taxabilityRule.findFirst({
      where: { jurisdictionId: input.jurisdictionId, category: input.category },
    });
    const data = { taxability: input.taxability, cpaConfirmedOn: input.cpaConfirmedOn,
      reason, updatedByUserId: actorId };
    const rule = existing
      ? await tx.taxabilityRule.update({ where: { id: existing.id }, data })
      : await tx.taxabilityRule.create({
          data: { ...data, category: input.category, jurisdictionId: input.jurisdictionId },
        });
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.setup.taxability_confirmed",
        entityType: "TaxabilityRule", entityId: rule.id,
        oldValue: existing ? { taxability: existing.taxability } : Prisma.JsonNull,
        newValue: { category: rule.category, jurisdictionId: input.jurisdictionId,
          taxability: rule.taxability, cpaConfirmedOn: input.cpaConfirmedOn.toISOString() } },
    });
  });
}

export async function addRdfRate(
  actorId: string, input: { effectiveOn: Date; amountCents: number },
): Promise<string> {
  const key = businessDateKey(input.effectiveOn);
  if (!key.endsWith("-07-01")) throw new Error("Colorado retail delivery fee rates start July 1.");
  const amountCents = cents(input.amountCents, 1000, "RDF amount");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const row = await tx.retailDeliveryFeeRate.create({
      data: { effectiveOn: businessDateFromKey(key)!, amountCents, enteredByUserId: actorId },
      select: { id: true },
    });
    await tx.auditLog.create({ data: {
      userId: actorId, action: "tax.setup.rdf_rate_created",
      entityType: "RetailDeliveryFeeRate", entityId: row.id,
      newValue: { effectiveOn: key, amountCents },
    } });
    return row.id;
  });
}


export async function addManualTaxRateVersion(actorId: string, input: {
  jurisdictionId: string;
  effectiveFrom: Date;
  rateMilliPercent: number;
  sourceNote: string;
}): Promise<string> {
  date(input.effectiveFrom, "effective date");
  const key = businessDateKey(input.effectiveFrom);
  const effectiveFrom = businessDateFromKey(key);
  if (!effectiveFrom) throw new Error("Invalid effective date.");
  const rateMilliPercent = cents(input.rateMilliPercent, 100_000, "rate");
  const sourceNote = textField(input.sourceNote, 500, "official rate evidence");
  if (!sourceNote) throw new Error("Explain the official rate evidence.");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "TaxJurisdiction" WHERE "id" = ${input.jurisdictionId} FOR UPDATE`;
    const jurisdiction = await tx.taxJurisdiction.findUniqueOrThrow({
      where: { id: input.jurisdictionId }, select: { id: true },
    });
    const latest = await tx.taxRateVersion.findFirst({
      where: { jurisdictionId: jurisdiction.id }, orderBy: { effectiveFrom: "desc" },
    });
    if (latest && effectiveFrom <= latest.effectiveFrom)
      throw new Error("New rate must follow the existing history; review corrections separately.");
    const row = await tx.taxRateVersion.create({
      data: {
        jurisdictionId: jurisdiction.id, effectiveFrom, rateMilliPercent,
        source: "MANUAL", sourceNote, recordedByUserId: actorId,
      }, select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "tax.setup.rate_version_appended",
        entityType: "TaxRateVersion", entityId: row.id,
        newValue: { jurisdictionId: jurisdiction.id, effectiveDate: key, rateMilliPercent },
      },
    });
    return row.id;
  });
}

