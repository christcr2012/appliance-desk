import { Prisma, RdfHandling, ShortTermLeaseElection, TaxFilingAccountKind, TaxFilingFrequency, TaxReportingBasis, Taxability, TaxChargeCategory } from "@prisma/client";
import { SERVICE_LINE_CATEGORIES } from "@/domains/tax/categories";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { cancelPendingDecisionChangesInTx } from "@/domains/decisions/pending";
import { isGreeleyJurisdiction, subjectForTaxCell } from "@/domains/decisions/tax-cells";
import { ruleAsOf } from "@/domains/rules/reads";
import { saveRuleVersion, saveRuleVersionInTx } from "@/domains/rules/changes";
import { assertRdfHandlingChangeable } from "./rdf-handling-lock";
import { licenseDefaultExpiry, nextLicenseExpiry } from "./license-dates";

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
  // TFA-1: the delivery-fee threshold is a dated rule, not a setting. The
  // form still sends it; a changed value becomes an OWNER rule version.
  const thresholdCents = cents(input.rdfThresholdCents, 1_000_000_000_00, "delivery fee threshold");
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { updatedAt: true, shortTermLeaseElection: true, rdfHandling: true,
        rdfCpaConfirmedOn: true, businessTaxAddress: true },
    });
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime())
      throw new Error("Settings changed in another session. Refresh before saving.");
    // TFA-2 §6.7: once the fee applies to a sale, who pays it is locked.
    if (changed.rdfHandling !== before.rdfHandling) await assertRdfHandlingChangeable(tx);
    const beforeThreshold = (await ruleAsOf<number>("co.rdf.qualified_threshold", new Date(), tx)).value;
    if (beforeThreshold !== thresholdCents) {
      await saveRuleVersionInTx(tx, actorId, {
        key: "co.rdf.qualified_threshold",
        value: thresholdCents,
        effectiveFrom: businessDateFromKey(businessDateKey(new Date()))!,
        reason: "Changed on the tax setup screen.",
      });
    }
    // A choice saved here is newer than one still waiting for its start date in Decisions & reviews.
    await cancelPendingDecisionChangesInTx(tx, actorId, [
      before.shortTermLeaseElection !== changed.shortTermLeaseElection ? "IN-33-ELECTION" : null,
      before.rdfHandling !== changed.rdfHandling ? "IN-37-RDF" : null,
    ], "A newer choice was saved in Tax setup.");
    const priorAddress = JSON.stringify(before.businessTaxAddress ?? {});
    if (priorAddress !== JSON.stringify(changed.businessTaxAddress)) {
      // Never carry the old jurisdictions forward after an address edit.
      // A manual/verified re-location must be completed before use tax resumes.
      await tx.addressTaxLocation.updateMany({
        where: { forBusinessLocation: true, isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.addressTaxLocation.create({
        data: {
          forBusinessLocation: true, isCurrent: true, status: "NEEDS_REVIEW",
          source: "MANUAL", lookedUpAt: new Date(),
          reviewNote: "Business tax address changed; confirm jurisdictions before purchase use tax.",
        },
      });
    }
    await tx.businessSettings.update({ where: { id: "singleton" }, data: changed });
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.setup.settings_updated",
        entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { leaseElection: before.shortTermLeaseElection, rdfHandling: before.rdfHandling,
          rdfThresholdCents: beforeThreshold, rdfCpaConfirmedOn: before.rdfCpaConfirmedOn?.toISOString() ?? null },
        newValue: { leaseElection: changed.shortTermLeaseElection, rdfHandling: changed.rdfHandling,
          rdfThresholdCents: thresholdCents,
          rdfCpaConfirmedOn: changed.rdfCpaConfirmedOn?.toISOString() ?? null,
          businessAddressChanged: priorAddress !== JSON.stringify(changed.businessTaxAddress) } },
    });
  });
  const { recalculatePendingPurchaseTax } = await import("./purchase-tax-catch-up");
  await recalculatePendingPurchaseTax(new Date(), 200);
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
  licenseExpiresOn?: Date | null;
  screenLabels?: Record<string, string>;
  deductionLabels?: Record<string, { label: string; reportAs: "DEDUCTION" | "LEAVE_OUT_OF_GROSS" }>;
  excelUploadAvailable?: boolean | null;
  bulkXmlAvailable?: boolean | null;
  setupCheckedOn?: Date | null;
  areaAssignments?: Array<{
    jurisdictionId: string; mode: "SALES" | "USE" | "NONE";
    filingCode: string | null; filingOrder: number; serviceFeeMilliPercent: number;
  }>;
};

function safeScreenLabels(value: FilingAccountInput["screenLabels"]) {
  if (value === undefined) return undefined;
  if (!value || Array.isArray(value) || Object.keys(value).length > 35)
    throw new Error("Invalid filing screen labels.");
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key) || typeof label !== "string")
      throw new Error("Invalid filing screen label key or value.");
    out[key] = textField(label, 120, "screen label") ?? "";
  }
  return out;
}
function safeDeductionLabels(value: FilingAccountInput["deductionLabels"]) {
  if (value === undefined) return undefined;
  if (!value || Array.isArray(value) || Object.keys(value).length > 35)
    throw new Error("Invalid SUTS deduction labels.");
  const out: Record<string, { label: string; reportAs: "DEDUCTION" | "LEAVE_OUT_OF_GROSS" }> = {};
  for (const [key, row] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(key) || !row ||
      !["DEDUCTION", "LEAVE_OUT_OF_GROSS"].includes(row.reportAs))
      throw new Error("Invalid deduction SUTS mapping.");
    const label = textField(row.label, 120, "deduction label");
    if (!label) throw new Error("Enter a deduction label.");
    out[key] = { label, reportAs: row.reportAs };
  }
  return out;
}

/**
 * TFA-2 §10: while the dated rule says the state license ends Dec 31 of odd
 * years, a sales account saved with no license date gets that date (Dec 31,
 * 2027 for the current cycle). Any other rule value, or a rule that cannot
 * be read, leaves the date for the owner to enter.
 */
async function licenseExpiryDefaultInTx(
  tx: Prisma.TransactionClient, now: Date,
): Promise<Date | null> {
  try {
    const rule = await ruleAsOf<{ rule?: unknown }>("co.license.expiry", now, tx);
    return rule.value?.rule === "DEC_31_ODD_YEARS" ? licenseDefaultExpiry(now) : null;
  } catch {
    return null;
  }
}

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
    licenseExpiresOn: input.licenseExpiresOn === undefined ? undefined : date(input.licenseExpiresOn, "license expiry"),
    screenLabels: safeScreenLabels(input.screenLabels),
    deductionLabels: safeDeductionLabels(input.deductionLabels),
    excelUploadAvailable: input.excelUploadAvailable,
    bulkXmlAvailable: input.bulkXmlAvailable,
    setupCheckedOn: input.setupCheckedOn === undefined ? undefined : date(input.setupCheckedOn, "setup confirmation"),
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
        select: { updatedAt: true, kind: true, basis: true, licenseExpiresOn: true, _count: { select: { periods: true } } },
      });
      if (before.kind !== data.kind && before._count.periods > 0)
        throw new Error("Filing accounts with recorded returns cannot change return type.");
      if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime())
        throw new Error("Filing account changed in another session.");
      if (before.basis !== data.basis)
        await cancelPendingDecisionChangesInTx(tx, actorId, ["IN-35-BASIS"],
          "A newer reporting basis was saved for a filing account.");
      // TFA-2 §10: an empty license date on a sales account that has none
      // gets the rule's date instead of staying blank.
      if (data.kind === "SALES_RETURN" && data.licenseExpiresOn === null && before.licenseExpiresOn === null)
        data.licenseExpiresOn = await licenseExpiryDefaultInTx(tx, new Date());
      await tx.taxFilingAccount.update({ where: { id: input.id }, data });
      id = input.id;
    } else {
      if (expectedUpdatedAt) throw new Error("A new account cannot have an old version.");
      if (data.kind === "SALES_RETURN" && data.licenseExpiresOn == null)
        data.licenseExpiresOn = await licenseExpiryDefaultInTx(tx, new Date());
      id = (await tx.taxFilingAccount.create({ data, select: { id: true } })).id;
    }
    if (input.areaAssignments !== undefined) {
      const assignments = [...input.areaAssignments].sort((a, b) => a.jurisdictionId.localeCompare(b.jurisdictionId));
      if (assignments.length > 100 ||
          assignments.some((row, i) => !row.jurisdictionId || (i > 0 &&
            row.jurisdictionId === assignments[i - 1]!.jurisdictionId)))
        throw new Error("Invalid or repeated filing jurisdiction assignment.");
      if (assignments.some(row => (row.mode === "SALES" && data.kind !== "SALES_RETURN") ||
          (row.mode === "USE" && data.kind !== "USE_TAX_RETURN") ||
          !["SALES", "USE", "NONE"].includes(row.mode)))
        throw new Error("Jurisdiction assignment does not match the filing account type.");
      if (assignments.length) {
        const keys = assignments.map(row => row.jurisdictionId);
        await tx.$queryRaw`SELECT "id" FROM "TaxJurisdiction" WHERE "id" IN (${Prisma.join(keys)}) ORDER BY "id" FOR UPDATE`;
        const matched = await tx.taxJurisdiction.findMany({
          where: { id: { in: keys } },
          select: { id: true, level: true, filingAccountId: true, useTaxFilingAccountId: true,
            filingCode: true, filingOrder: true, serviceFeeMilliPercent: true },
        });
        if (matched.length !== keys.length) throw new Error("A selected tax jurisdiction was not found.");
        const byId = new Map(matched.map(row => [row.id, row]));
        const changedAssignments = assignments.flatMap(row => {
          const before = byId.get(row.jurisdictionId)!;
          const salesId = row.mode === "SALES" ? id :
            before.filingAccountId === id ? null : before.filingAccountId;
          const useId = row.mode === "USE" ? id :
            before.useTaxFilingAccountId === id ? null : before.useTaxFilingAccountId;
          if ((row.mode === "SALES" && before.filingAccountId && before.filingAccountId !== id) ||
              (row.mode === "USE" && before.useTaxFilingAccountId && before.useTaxFilingAccountId !== id))
            throw new Error("Tax jurisdiction belongs to a different filing account.");
          const code = textField(row.filingCode, 40, "SUTS filing code");
          const order = cents(row.filingOrder, 10000, "SUTS filing order");
          // TFA-1: the state line's service fee is set by the dated rule, not
          // by this form. Keep the stored value so a crafted submit cannot change it.
          const fee = before.level === "STATE"
            ? before.serviceFeeMilliPercent
            : cents(row.serviceFeeMilliPercent, 100000, "area service fee");
          const modified = salesId !== before.filingAccountId || useId !== before.useTaxFilingAccountId ||
            (row.mode !== "NONE" && (code !== before.filingCode || order !== before.filingOrder ||
              fee !== before.serviceFeeMilliPercent));
          return modified ? [{ row, salesId, useId, code, order, fee }] : [];
        });
        if (changedAssignments.length && await tx.taxFilingPeriod.count({
          where: { filingAccountId: id, status: "FILED" },
        })) throw new Error("Filed returns exist; review historical-area effects before changing assignments.");
        for (const row of changedAssignments) {
          await tx.taxJurisdiction.update({
            where: { id: row.row.jurisdictionId },
            data: {
              filingAccountId: row.salesId, useTaxFilingAccountId: row.useId,
              ...(row.row.mode !== "NONE" ? {
                filingCode: row.code, filingOrder: row.order, serviceFeeMilliPercent: row.fee,
              } : {}),
            },
          });
        }
      }
    }
    if (data.kind === "USE_TAX_RETURN" && input.areaAssignments !== undefined) {
      const { assignDueUseTaxRowsToPeriod } = await import("./use-tax");
      const periods = await tx.taxFilingPeriod.findMany({
        where: { filingAccountId: id, status: "OPEN" },
        select: { id: true }, orderBy: [{ periodStart: "asc" }, { id: "asc" }],
      });
      for (const period of periods) await assignDueUseTaxRowsToPeriod(tx, period.id);
    }
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.setup.filing_account_saved",
        entityType: "TaxFilingAccount", entityId: id,
        newValue: { name: data.name, kind: data.kind, frequency: data.frequency,
          basis: data.basis, firstPeriodStart: data.firstPeriodStart?.toISOString() ?? null,
          licenseExpiresOn: data.licenseExpiresOn?.toISOString() ?? null,
          screenLabelKeys: Object.keys(data.screenLabels ?? {}),
          deductionKeys: Object.keys(data.deductionLabels ?? {}),
          excelUploadAvailable: data.excelUploadAvailable ?? null,
          bulkXmlAvailable: data.bulkXmlAvailable ?? null,
          setupCheckedOn: data.setupCheckedOn?.toISOString() ?? null,
          assignedJurisdictionIds: input.areaAssignments?.filter(row => row.mode !== "NONE").map(row => row.jurisdictionId) ?? [],
          configured: Boolean(data.accountNumber && data.firstPeriodStart && data.basis !== "UNDECIDED") } },
    });
    return { id };
  });
}

/**
 * TFA-2 §10: the owner renewed the state license. The stored expiry rolls
 * to Dec 31 of the next odd year (2027 becomes 2029), and the renewal is
 * audited. The current date must be on file first: renewing extends a real
 * license, it does not invent one.
 */
export async function markLicenseRenewed(
  actorId: string, accountId: string,
): Promise<{ licenseExpiresOn: Date }> {
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "TaxFilingAccount" WHERE "id" = ${accountId} FOR UPDATE`;
    const account = await tx.taxFilingAccount.findUniqueOrThrow({
      where: { id: accountId }, select: { licenseExpiresOn: true },
    });
    if (!account.licenseExpiresOn)
      throw new Error("Enter the current license expiration first, then mark it renewed.");
    const next = nextLicenseExpiry(account.licenseExpiresOn);
    await tx.taxFilingAccount.update({
      where: { id: accountId }, data: { licenseExpiresOn: next },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "tax.license.renewed",
        entityType: "TaxFilingAccount", entityId: accountId,
        oldValue: { licenseExpiresOn: account.licenseExpiresOn.toISOString() },
        newValue: { licenseExpiresOn: next.toISOString() } },
    });
    return { licenseExpiresOn: next };
  });
}

export type TaxabilityCellInput = { jurisdictionId: string | null; category: TaxChargeCategory; taxability: Taxability;
  cpaConfirmedOn: Date; reason: string;
  /** FEETAX-1: the answer for a service the customer can decline when it is listed separately.
   * Omit it and a confirmed save settles a service cell with the confirmed answer itself — a
   * CPA-confirmed "taxed" must never leave a researched "not taxed when separate" running
   * underneath it. Pass it when the CPA answered the separate question differently. */
  optionalSeparatedTreatment?: Taxability | null };
/** When a decision's change starts (Decisions & reviews): the history version starts then. Default: today. */
export type TaxabilityCellOptions = { effectiveFrom?: Date;
  /** ACCT-1: accountant only as a CPA professional answer through Decisions & reviews. */
  professionalAnswer?: boolean };

function checkConfirmedCell(input: TaxabilityCellInput) {
  enumValue(input.category, TaxChargeCategory, "tax category");
  enumValue(input.taxability, Taxability, "taxability");
  if (input.taxability === "UNDECIDED") throw new Error("The confirmed cell must be taxable or exempt.");
  if (input.optionalSeparatedTreatment != null) {
    enumValue(input.optionalSeparatedTreatment, Taxability, "taxability");
    if (input.optionalSeparatedTreatment === "UNDECIDED")
      throw new Error("The optional-and-separate answer must be taxable or exempt when it is given.");
  }
  date(input.cpaConfirmedOn, "CPA confirmation date");
  if (!input.cpaConfirmedOn) throw new Error("Taxability confirmation needs a CPA date.");
  const reason = textField(input.reason, 500, "CPA decision") ?? "";
  if (!reason) throw new Error("Explain the confirmed taxability decision.");
  return reason;
}

export async function saveTaxabilityCell(actorId: string, input: TaxabilityCellInput): Promise<void> {
  checkConfirmedCell(input);
  await prisma.$transaction(tx => saveTaxabilityCellInTx(tx, actorId, input));
}

/**
 * Locks the cell's owner row (the tax area, or the settings row for the all-state defaults) like every cell save, and
 * cancels a Decisions & reviews change still waiting for this cell: this save is the newer decision.
 */
async function lockTaxabilityCell(
  tx: Prisma.TransactionClient, actorId: string, jurisdictionId: string | null, category: TaxChargeCategory,
) {
  let jurisdiction: { level: string; administration: string; name: string } | null = null;
  if (jurisdictionId === null) {
    // Default all-state rules have NULL jurisdictionId; lock singleton
    // so two owners cannot create duplicate nullable unique rows.
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "TaxJurisdiction" WHERE "id" = ${jurisdictionId} FOR UPDATE`;
    jurisdiction = await tx.taxJurisdiction.findUniqueOrThrow({
      where: { id: jurisdictionId }, select: { level: true, administration: true, name: true },
    });
  }
  await cancelPendingDecisionChangesInTx(tx, actorId, [subjectForTaxCell(category, jurisdiction)],
    "A newer tax rule was saved for this charge.");
}

/** Start of a Colorado business day, stored UTC. */
function businessDayStart(at: Date): Date {
  return businessDateFromKey(businessDateKey(at))!;
}

/**
 * Appends the cell's history version (DEC-1a). The first time a cell gets a version, what it was before (its stored
 * value, or "not decided" when no rule was stored) is kept from 1970-01-01, so old dates keep their old answer.
 */
async function appendTaxabilityVersion(
  tx: Prisma.TransactionClient,
  existing: { taxability: Taxability; provisional: boolean; cpaConfirmedOn: Date | null; reason: string | null;
    optionalSeparatedTreatment?: Taxability | null } | null,
  row: { jurisdictionId: string | null; category: TaxChargeCategory; taxability: Taxability; provisional: boolean;
    cpaConfirmedOn: Date | null; reason: string | null; sources: Prisma.InputJsonValue | null; actorId: string;
    effectiveFrom: Date; optionalSeparatedTreatment?: Taxability | null },
) {
  const earlier = await tx.taxabilityRuleVersion.count({
    where: { jurisdictionId: row.jurisdictionId, category: row.category },
  });
  if (earlier === 0) {
    // Before this cell had a stored rule it was "not decided": a rule saved today never reaches back to old dates.
    await tx.taxabilityRuleVersion.create({ data: {
      jurisdictionId: row.jurisdictionId, category: row.category, taxability: existing?.taxability ?? "UNDECIDED",
      optionalSeparatedTreatment: existing?.optionalSeparatedTreatment ?? null,
      effectiveFrom: new Date(Date.UTC(1970, 0, 1)), provisional: existing?.provisional ?? false,
      cpaConfirmedOn: existing?.cpaConfirmedOn ?? null, reason: existing?.reason ?? null,
    } });
  }
  await tx.taxabilityRuleVersion.create({ data: {
    jurisdictionId: row.jurisdictionId, category: row.category, taxability: row.taxability,
    optionalSeparatedTreatment: row.optionalSeparatedTreatment !== undefined
      ? row.optionalSeparatedTreatment : existing?.optionalSeparatedTreatment ?? null,
    effectiveFrom: row.effectiveFrom, provisional: row.provisional, cpaConfirmedOn: row.cpaConfirmedOn,
    reason: row.reason, sources: row.sources ?? Prisma.DbNull, createdByUserId: row.actorId,
  } });
}

/**
 * The confirmed-cell save inside a transaction the caller owns (Decisions & reviews runs several steps in one).
 * Same checks, locks, audit and history as `saveTaxabilityCell`; confirming clears a provisional starting value.
 */
export async function saveTaxabilityCellInTx(
  tx: Prisma.TransactionClient, actorId: string, input: TaxabilityCellInput, opts: TaxabilityCellOptions = {},
): Promise<void> {
  const reason = checkConfirmedCell(input);
  await assertActiveTeamActor(tx, actorId, opts.professionalAnswer ? ["ACCOUNTANT"] : ["OWNER"]);
  await lockTaxabilityCell(tx, actorId, input.jurisdictionId, input.category);
  const existing = await tx.taxabilityRule.findFirst({
    where: { jurisdictionId: input.jurisdictionId, category: input.category },
  });
  // FEETAX-1: a confirmed answer settles the whole cell. For a service charge the
  // optional-and-separate answer follows the confirmed answer unless the CPA gave
  // that answer separately — otherwise a seeded "not taxed when separate" starting
  // value would keep deciding real bills after the cell was confirmed, unflagged.
  const separateAnswer = input.optionalSeparatedTreatment !== undefined
    ? input.optionalSeparatedTreatment
    : (SERVICE_LINE_CATEGORIES as readonly string[]).includes(input.category) ? input.taxability : undefined;
  const data = { taxability: input.taxability, cpaConfirmedOn: input.cpaConfirmedOn,
    reason, updatedByUserId: actorId,
    provisional: false, provisionalReason: null, provisionalSources: Prisma.DbNull,
    ...(separateAnswer !== undefined ? { optionalSeparatedTreatment: separateAnswer } : {}) };
  const rule = existing
    ? await tx.taxabilityRule.update({ where: { id: existing.id }, data })
    : await tx.taxabilityRule.create({
        data: { ...data, category: input.category, jurisdictionId: input.jurisdictionId },
      });
  await appendTaxabilityVersion(tx, existing, {
    jurisdictionId: input.jurisdictionId, category: input.category, taxability: input.taxability,
    provisional: false, cpaConfirmedOn: input.cpaConfirmedOn, reason, sources: null, actorId,
    effectiveFrom: opts.effectiveFrom ?? businessDayStart(new Date()),
    ...(separateAnswer !== undefined ? { optionalSeparatedTreatment: separateAnswer } : {}),
  });
  await tx.auditLog.create({
    data: { userId: actorId, action: "tax.setup.taxability_confirmed",
      entityType: "TaxabilityRule", entityId: rule.id,
      oldValue: existing ? { taxability: existing.taxability, provisional: existing.provisional } : Prisma.JsonNull,
      newValue: { category: rule.category, jurisdictionId: input.jurisdictionId,
        taxability: rule.taxability, cpaConfirmedOn: input.cpaConfirmedOn.toISOString(),
        optionalSeparatedTreatment: rule.optionalSeparatedTreatment } },
  });
}

export type DecisionSource = { title: string; url: string; checkedOn: string };
export type ProvisionalTaxabilityInput = { jurisdictionId: string | null; category: TaxChargeCategory;
  taxability: Taxability; reason: string; sources: DecisionSource[];
  /** FEETAX-1: a researched answer for the optional-and-separate question, when the
   * research speaks to it. Omitted: the cell's existing separate answer is left alone. */
  optionalSeparatedTreatment?: Taxability | null };

function checkSources(sources: DecisionSource[]): DecisionSource[] {
  if (!Array.isArray(sources) || sources.length > 20) throw new Error("Invalid source list.");
  return sources.map(source => {
    const title = textField(source.title, 200, "source title");
    if (!title || typeof source.url !== "string" || !/^https:\/\//.test(source.url) || source.url.length > 500 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedOn ?? ""))
      throw new Error("Each source needs a title, an https link and the date it was checked.");
    return { title, url: source.url, checkedOn: source.checkedOn };
  });
}

/**
 * DEC-1a section 5: run a researched taxable/exempt starting value before the CPA confirms it. Same locks and owner
 * check as the confirmed save; the cell is marked provisional (no CPA date) and the tax engine labels results that
 * use it "not confirmed". Never accepts UNDECIDED.
 */
export async function saveProvisionalTaxabilityCell(actorId: string, input: ProvisionalTaxabilityInput): Promise<void> {
  await prisma.$transaction(tx => saveProvisionalTaxabilityCellInTx(tx, actorId, input));
}

export async function saveProvisionalTaxabilityCellInTx(
  tx: Prisma.TransactionClient, actorId: string, input: ProvisionalTaxabilityInput, opts: TaxabilityCellOptions = {},
): Promise<void> {
  enumValue(input.category, TaxChargeCategory, "tax category");
  enumValue(input.taxability, Taxability, "taxability");
  if (input.taxability === "UNDECIDED") throw new Error("A starting value must be taxable or exempt.");
  const reason = textField(input.reason, 500, "starting value reason") ?? "";
  if (!reason) throw new Error("Explain why this starting value was chosen.");
  const sources = checkSources(input.sources);
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await lockTaxabilityCell(tx, actorId, input.jurisdictionId, input.category);
  const existing = await tx.taxabilityRule.findFirst({
    where: { jurisdictionId: input.jurisdictionId, category: input.category },
  });
  const data = { taxability: input.taxability, cpaConfirmedOn: null, reason, updatedByUserId: actorId,
    provisional: true, provisionalReason: reason, provisionalSources: sources,
    ...(input.optionalSeparatedTreatment !== undefined
      ? { optionalSeparatedTreatment: input.optionalSeparatedTreatment } : {}) };
  const rule = existing
    ? await tx.taxabilityRule.update({ where: { id: existing.id }, data })
    : await tx.taxabilityRule.create({
        data: { ...data, category: input.category, jurisdictionId: input.jurisdictionId },
      });
  await appendTaxabilityVersion(tx, existing, {
    jurisdictionId: input.jurisdictionId, category: input.category, taxability: input.taxability,
    provisional: true, cpaConfirmedOn: null, reason, sources, actorId,
    effectiveFrom: opts.effectiveFrom ?? businessDayStart(new Date()),
    ...(input.optionalSeparatedTreatment !== undefined
      ? { optionalSeparatedTreatment: input.optionalSeparatedTreatment } : {}),
  });
  await tx.auditLog.create({
    data: { userId: actorId, action: "tax.setup.taxability_starting_value",
      entityType: "TaxabilityRule", entityId: rule.id,
      oldValue: existing ? { taxability: existing.taxability, provisional: existing.provisional } : Prisma.JsonNull,
      newValue: { category: rule.category, jurisdictionId: input.jurisdictionId,
        taxability: rule.taxability, provisional: true, sourceCount: sources.length } },
  });
}

export async function addRdfRate(
  actorId: string, input: { effectiveOn: Date; amountCents: number },
): Promise<string> {
  const key = businessDateKey(input.effectiveOn);
  if (!key.endsWith("-07-01")) throw new Error("Colorado retail delivery fee rates start July 1.");
  const amountCents = cents(input.amountCents, 1000, "RDF amount");
  // TFA-1: a July rate is an OWNER rule version, not a rate-table row. A
  // past July 1 runs the late-change true-up in the same transaction.
  const { versionId } = await saveRuleVersion(actorId, {
    key: "co.rdf.amount",
    value: amountCents,
    effectiveFrom: businessDateFromKey(key)!,
    reason: "Recorded on the tax setup screen.",
  });
  return versionId;
}


export async function addManualTaxRateVersion(actorId: string, input: {
  jurisdictionId: string;
  effectiveFrom: Date;
  rateMilliPercent: number;
  sourceNote: string;
}): Promise<string> {
  checkManualRateInput(input);
  return prisma.$transaction(tx => addManualTaxRateVersionInTx(tx, actorId, input));
}

function checkManualRateInput(input: { effectiveFrom: Date; rateMilliPercent: number; sourceNote: string }) {
  date(input.effectiveFrom, "effective date");
  const key = businessDateKey(input.effectiveFrom);
  const effectiveFrom = businessDateFromKey(key);
  if (!effectiveFrom) throw new Error("Invalid effective date.");
  const rateMilliPercent = cents(input.rateMilliPercent, 100_000, "rate");
  const sourceNote = textField(input.sourceNote, 500, "official rate evidence");
  if (!sourceNote) throw new Error("Explain the official rate evidence.");
  return { key, effectiveFrom, rateMilliPercent, sourceNote };
}

/** The same save inside a caller's transaction (Decisions & reviews: the city rate answer, DEC-2). */
export async function addManualTaxRateVersionInTx(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: { jurisdictionId: string; effectiveFrom: Date; rateMilliPercent: number; sourceNote: string },
): Promise<string> {
  const { key, effectiveFrom, rateMilliPercent, sourceNote } = checkManualRateInput(input);
  await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "TaxJurisdiction" WHERE "id" = ${input.jurisdictionId} FOR UPDATE`;
  const jurisdiction = await tx.taxJurisdiction.findUniqueOrThrow({
    where: { id: input.jurisdictionId },
    select: { id: true, name: true, level: true, administration: true },
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
  // TFA-3 gate G3: a Greeley rate saved here (Areas page or the
  // GREELEY-RATE-2F decision) also lands in the rule book's
  // greeley.sales_rate, so the Rules screen agrees with the rate bills
  // use. The TaxRateVersion above stays the operative write.
  if (isGreeleyJurisdiction(jurisdiction)) {
    await saveRuleVersionInTx(tx, actorId, {
      key: "greeley.sales_rate",
      value: rateMilliPercent,
      effectiveFrom,
      reason: "Greeley rate saved with the tax area rate",
      origin: "OWNER",
    });
  }
  return row.id;
}

