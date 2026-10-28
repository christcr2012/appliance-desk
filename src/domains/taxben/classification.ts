import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { SYSTEM_ACCOUNTS } from "@/domains/books/accounts";
import { ruleAsOf, RuleMissingError } from "@/domains/rules/reads";

/**
 * TAXBEN-1 — classification (docs/build-specs/engines/TAX-BENEFITS.md section 1).
 *
 * Every books expense account maps to a deduction (Schedule C line, percent,
 * kind) in the system chart. Mixed-use accounts (PERSONAL_SHARE) deduct the
 * owner's business-use percent for the account — asked once in guided setup;
 * until answered, the percent is 0 and nothing is deducted.
 *
 * Every purchased unit is expensed or capitalized by the rules in the spec's
 * order, and the decision is recorded on the unit with its reason in plain
 * words. A recorded decision is never rewritten: later rule or election
 * changes apply to later purchases only (the TFA-1 late-change doctrine).
 *
 * Every number comes from the rule book (ruleAsOf) or the chart — never a
 * literal here; tests/taxben-rule-book-lint.test.ts guards the module.
 */

// ---------------------------------------------------------------------------
// Deduction mapping (system chart)
// ---------------------------------------------------------------------------

export type DeductionKind = "ORDINARY" | "CAPITAL" | "PERSONAL_SHARE";
export type DeductionMapping = {
  scheduleCLine: string | null;
  percent: number;
  kind: DeductionKind;
};

type ChartAccount = {
  role: string;
  name: string;
  type: string;
  deduction?: DeductionMapping;
};

const CHART_ACCOUNTS = SYSTEM_ACCOUNTS as unknown as ChartAccount[];

/** The chart's deduction mapping for one expense account role, or null. */
export function deductionMappingForRole(role: string): DeductionMapping | null {
  const account = CHART_ACCOUNTS.find((entry) => entry.role === role);
  return account?.deduction ?? null;
}

/** Every expense account with its deduction mapping, in chart order. */
export function allDeductionMappings(): { role: string; name: string; mapping: DeductionMapping }[] {
  return CHART_ACCOUNTS
    .filter((entry) => entry.type === "EXPENSE" && entry.deduction)
    .map((entry) => ({ role: entry.role, name: entry.name, mapping: entry.deduction! }));
}

// ---------------------------------------------------------------------------
// Owner settings: business-use percents and the de minimis election
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the stored business-use percents (role → 0..100). Bad entries are dropped. */
export function parseBusinessUsePercents(json: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!isRecord(json)) return result;
  for (const [role, value] of Object.entries(json)) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100) {
      result.set(role, value);
    }
  }
  return result;
}

/** The owner's answered business-use percent for a role, or null when unanswered. */
export function businessUsePercentFor(json: unknown, role: string): number | null {
  return parseBusinessUsePercents(json).get(role) ?? null;
}

/**
 * The percent of an account's year total that is deducted. PERSONAL_SHARE
 * accounts deduct the owner's answered business-use percent — 0 until
 * answered. Unmapped roles return null (not an expense deduction at all).
 */
export function effectiveDeductionPercent(role: string, businessUsePercents: unknown): number | null {
  const mapping = deductionMappingForRole(role);
  if (!mapping) return null;
  if (mapping.kind === "PERSONAL_SHARE") return businessUsePercentFor(businessUsePercents, role) ?? 0;
  return mapping.percent;
}

/**
 * Is the de minimis election on for a tax year? The elections setting is a
 * per-year map; a year with no entry uses the starting value: on
 * (DQ-TAXBEN-DE-MINIMIS — the CPA confirms).
 */
export function deMinimisElectionFor(json: unknown, year: number): boolean {
  if (!isRecord(json)) return true;
  const value = json[String(year)];
  return typeof value === "boolean" ? value : true;
}

// ---------------------------------------------------------------------------
// The capital-vs-expense decision (pure)
// ---------------------------------------------------------------------------

export type CapDecision =
  | "EXPENSED_DE_MINIMIS"
  | "CAPITALIZED_BONUS"
  | "CAPITALIZED_SECTION179"
  | "CAPITALIZED";

export type CapitalizationFacts = {
  /** The invoice line for this unit: its price plus its share of the delivery/installation charges on the same invoice. */
  lineCents: number;
  purchasedOn: Date;
  taxYear: number;
  electionOn: boolean;
  deMinimisLimitCents: number | null;
  bonusPercent: number | null;
  /** "YYYY-MM-DD": bonus applies to property acquired after this date. */
  bonusAcquiredAfter: string | null;
  preferSection179: boolean;
  section179: { limitCents: number; phaseoutCents: number } | null;
  classLifeMonths: number | null;
  boughtFromRelatedParty: boolean | null;
};

export type CapitalizationOutcome = {
  decision: CapDecision;
  reason: string;
  ruleKey: string;
  ruleValue: string;
};

function acquiredAfter(purchasedOn: Date, boundary: string | null): boolean {
  if (!boundary) return false;
  // Compare on the Denver business date so a late-evening purchase is not
  // pushed across the boundary by UTC.
  return businessDateKey(purchasedOn) > boundary;
}

/** Decide one unit, in the spec's order. Pure — every value arrives as a fact. */
export function decideCapitalization(facts: CapitalizationFacts): CapitalizationOutcome {
  const line = formatMoney(facts.lineCents);
  if (facts.electionOn && facts.deMinimisLimitCents !== null && facts.lineCents <= facts.deMinimisLimitCents) {
    return {
      decision: "EXPENSED_DE_MINIMIS",
      reason: `Expensed under the de minimis safe harbor: this line was ${line}, at or under the ${formatMoney(facts.deMinimisLimitCents)} limit, and the ${facts.taxYear} election is on. The unit stays in the asset register.`,
      ruleKey: "us.de_minimis_per_item",
      ruleValue: String(facts.deMinimisLimitCents),
    };
  }
  const why = !facts.electionOn
    ? `Capitalized: the de minimis election is off for ${facts.taxYear}, so this purchase is capitalized.`
    : facts.deMinimisLimitCents !== null
      ? `Capitalized: this line was ${line}, over the ${formatMoney(facts.deMinimisLimitCents)} de minimis limit.`
      : `Capitalized: the de minimis limit could not be read, so this purchase is capitalized.`;
  if (facts.preferSection179) {
    return {
      decision: "CAPITALIZED_SECTION179",
      reason: `${why} Your CPA's choice is Section 179 expensing for equipment like this.`,
      ruleKey: "us.section179",
      ruleValue: facts.section179 ? JSON.stringify(facts.section179) : "",
    };
  }
  if (facts.boughtFromRelatedParty === true) {
    return {
      decision: "CAPITALIZED",
      reason: `${why} Bonus depreciation is not available: this was bought from a relative or your own other business, so it is written off over its class life.`,
      ruleKey: "us.bonus_depreciation",
      ruleValue: JSON.stringify({ percent: facts.bonusPercent, acquiredAfter: facts.bonusAcquiredAfter }),
    };
  }
  if (facts.bonusPercent !== null && facts.bonusPercent > 0 && acquiredAfter(facts.purchasedOn, facts.bonusAcquiredAfter)) {
    return {
      decision: "CAPITALIZED_BONUS",
      reason: `${why} ${facts.bonusPercent}% bonus depreciation applies (property acquired after ${facts.bonusAcquiredAfter}).`,
      ruleKey: "us.bonus_depreciation",
      ruleValue: JSON.stringify({ percent: facts.bonusPercent, acquiredAfter: facts.bonusAcquiredAfter }),
    };
  }
  const life = facts.classLifeMonths !== null ? ` over ${facts.classLifeMonths} months` : "";
  return {
    decision: "CAPITALIZED",
    reason: `${why} It is written off over its class life${life}.`,
    ruleKey: "us.class_life_months",
    ruleValue: facts.classLifeMonths !== null ? String(facts.classLifeMonths) : "",
  };
}

/**
 * Split an invoice-level amount (delivery/installation charges) across units
 * by price, largest remainder, so the shares sum exactly. All-zero prices
 * split evenly. Pure.
 */
export function allocateByPrice(pricesCents: number[], totalCents: number): number[] {
  if (pricesCents.length === 0) return [];
  if (totalCents === 0) return pricesCents.map(() => 0);
  const totalPrice = pricesCents.reduce((sum, price) => sum + price, 0);
  const weights = totalPrice > 0 ? pricesCents : pricesCents.map(() => 1);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (totalCents * weight) / weightSum);
  const shares = exact.map((value) => Math.floor(value));
  let remainder = totalCents - shares.reduce((sum, share) => sum + share, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of byFraction) {
    if (remainder <= 0) break;
    shares[entry.index]! += 1;
    remainder -= 1;
  }
  return shares;
}

/**
 * Placed in service is the first day a unit is AVAILABLE, not the purchase
 * date. The book asset's attested date wins when the unit is enrolled;
 * before enrollment, the purchase date is the fleet record's best date.
 */
export function resolvePlacedInService(input: {
  purchaseDate: Date | null;
  bookPlacedInServiceOn: Date | null;
}): Date | null {
  return input.bookPlacedInServiceOn ?? input.purchaseDate;
}

// ---------------------------------------------------------------------------
// Recording decisions on a purchase's units
// ---------------------------------------------------------------------------

async function ruleOrNull<T>(
  tx: Prisma.TransactionClient,
  key: "us.de_minimis_per_item" | "us.bonus_depreciation" | "us.section179" | "us.class_life_months",
  at: Date,
): Promise<T | null> {
  try {
    const { value } = await ruleAsOf<T>(key, at, tx);
    return value;
  } catch (error) {
    if (error instanceof RuleMissingError) return null;
    throw error;
  }
}

/**
 * Record the capital-vs-expense decision for every undecided unit on a
 * purchase. The caller owns the transaction and the actor check; the
 * purchase row is locked first so two runs cannot race. Units already
 * decided are never touched. Returns how many units were decided.
 */
export async function classifyPurchaseInTx(
  tx: Prisma.TransactionClient,
  purchaseId: string,
  actorId: string,
  now = new Date(),
): Promise<number> {
  await tx.$queryRaw`SELECT "id" FROM "Purchase" WHERE "id" = ${purchaseId} FOR UPDATE`;
  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true, purchasedOn: true, otherChargesCents: true, boughtFromRelatedParty: true,
      appliances: {
        orderBy: [{ createdAt: "asc" }, { assetNumber: "asc" }],
        select: { id: true, acquisitionCostCents: true, capDecision: true },
      },
    },
  });
  if (!purchase) throw new Error("Purchase not found.");
  const undecided = purchase.appliances.filter((unit) => unit.capDecision === null);
  if (undecided.length === 0) return 0;

  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { deMinimisElections: true, capitalizationPreference: true },
  });
  const taxYear = Number(businessDateKey(purchase.purchasedOn).slice(0, 4));
  const electionOn = deMinimisElectionFor(settings?.deMinimisElections, taxYear);
  const preferSection179 = settings?.capitalizationPreference === "SECTION179";

  const deMinimisLimitCents = await ruleOrNull<number>(tx, "us.de_minimis_per_item", purchase.purchasedOn);
  const bonus = await ruleOrNull<{ percent: number; acquiredAfter: string }>(tx, "us.bonus_depreciation", purchase.purchasedOn);
  const section179 = await ruleOrNull<{ limitCents: number; phaseoutCents: number }>(tx, "us.section179", purchase.purchasedOn);
  const classLives = await ruleOrNull<{ rentalAppliances: number; tools: number }>(tx, "us.class_life_months", purchase.purchasedOn);

  const prices = purchase.appliances.map((unit) => unit.acquisitionCostCents ?? 0);
  const shares = allocateByPrice(prices, purchase.otherChargesCents);
  const indexById = new Map(purchase.appliances.map((unit, index) => [unit.id, index]));

  const decided: { applianceId: string; decision: CapDecision; lineCents: number }[] = [];
  for (const unit of undecided) {
    const index = indexById.get(unit.id)!;
    const lineCents = (unit.acquisitionCostCents ?? 0) + (shares[index] ?? 0);
    const outcome = decideCapitalization({
      lineCents,
      purchasedOn: purchase.purchasedOn,
      taxYear,
      electionOn,
      deMinimisLimitCents,
      bonusPercent: bonus?.percent ?? null,
      bonusAcquiredAfter: bonus?.acquiredAfter ?? null,
      preferSection179,
      section179,
      classLifeMonths: classLives?.rentalAppliances ?? null,
      boughtFromRelatedParty: purchase.boughtFromRelatedParty,
    });
    await tx.appliance.update({
      where: { id: unit.id },
      data: {
        capDecision: outcome.decision,
        capReason: outcome.reason,
        capLineCents: lineCents,
        capRuleKey: outcome.ruleKey,
        capRuleValue: outcome.ruleValue,
        capDecidedAt: now,
        capPlacedInServiceOn: purchase.purchasedOn,
      },
    });
    decided.push({ applianceId: unit.id, decision: outcome.decision, lineCents });
  }

  await tx.auditLog.create({
    data: {
      userId: actorId, action: "taxben.capitalization_decided", entityType: "Purchase", entityId: purchase.id,
      newValue: { decisions: decided },
    },
  });
  return decided.length;
}

/**
 * Standalone classification for a purchase recorded before the decisions
 * existed (owner or admin; decisions are bookkeeping over the owner's own
 * purchase evidence).
 */
export async function classifyPurchase(actorId: string, purchaseId: string, now = new Date()): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    return classifyPurchaseInTx(tx, purchaseId, actorId, now);
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** The shared (personal/business) accounts the owner answers a percent for. */
export function personalShareAccounts(): { role: string; name: string }[] {
  return CHART_ACCOUNTS
    .filter((account) => account.deduction?.kind === "PERSONAL_SHARE")
    .map((account) => ({ role: account.role, name: account.name }));
}

export type WriteOffSettingsInput = {
  /** Role -> business-use percent, for PERSONAL_SHARE accounts only. */
  businessUsePercents?: Record<string, number>;
  enterpriseZone?: "YES" | "NO" | "UNKNOWN";
  deMinimisElection?: { year: number; on: boolean };
  capitalizationPreference?: "BONUS" | "SECTION179";
};

/**
 * The write-off settings save (Taxes > Tax benefits): the business-use
 * answers, the enterprise-zone answer, a year's de minimis election and
 * the capitalization preference. Audited; only the fields given change.
 */
export async function saveWriteOffSettings(
  actorId: string,
  input: WriteOffSettingsInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const settings = await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });
    const data: Prisma.BusinessSettingsUpdateInput = {};
    if (input.businessUsePercents) {
      const merged: Record<string, number> = { ...Object.fromEntries(parseBusinessUsePercents(settings.businessUsePercents)) };
      for (const [role, percent] of Object.entries(input.businessUsePercents)) {
        const mapping = deductionMappingForRole(role);
        if (!mapping || mapping.kind !== "PERSONAL_SHARE") {
          throw new Error("That account does not take a business-use percent.");
        }
        if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
          throw new Error("A business-use percent is a whole number from 0 to 100.");
        }
        merged[role] = percent;
      }
      data.businessUsePercents = merged;
    }
    if (input.deMinimisElection) {
      const existing =
        settings.deMinimisElections && typeof settings.deMinimisElections === "object" && !Array.isArray(settings.deMinimisElections)
          ? (settings.deMinimisElections as Record<string, unknown>)
          : {};
      data.deMinimisElections = {
        ...existing,
        [String(input.deMinimisElection.year)]: input.deMinimisElection.on,
      } as Prisma.InputJsonValue;
    }
    if (input.enterpriseZone) data.enterpriseZone = input.enterpriseZone;
    if (input.capitalizationPreference) data.capitalizationPreference = input.capitalizationPreference;
    await tx.businessSettings.update({ where: { id: "singleton" }, data });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "taxben.settings_saved", entityType: "BusinessSettings", entityId: "singleton",
        newValue: {
          businessUsePercents: input.businessUsePercents ?? undefined,
          enterpriseZone: input.enterpriseZone ?? undefined,
          deMinimisElection: input.deMinimisElection ?? undefined,
          capitalizationPreference: input.capitalizationPreference ?? undefined,
        },
      },
    });
  }, { timeout: 30_000, maxWait: 10_000 });
}
