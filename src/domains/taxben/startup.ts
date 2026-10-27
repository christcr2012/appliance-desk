import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { ruleAsOf, RuleMissingError } from "@/domains/rules/reads";
import { deductionMappingForRole } from "./classification";

/**
 * TAXBEN-1 — start-up costs (docs/build-specs/engines/TAX-BENEFITS.md section 2).
 *
 * The day the business began is a compliance fact. Its starting value is the
 * earlier of the day the first appliance became AVAILABLE and the day the
 * public site took its first lead (DQ-TAXBEN-BEGAN — the CPA confirms).
 * Posted expenses dated before that day are start-up costs, excluding fleet
 * purchases, interest and taxes (Section 195 leaves those to other rules).
 *
 * The deduction: a first-year amount that shrinks once total start-up costs
 * pass the phase-out start, with the rest spread evenly over the rule's
 * months from the month the business began. Every figure comes from the
 * rule book (us.startup_costs) — never a literal here.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type StartupRule = {
  deductionCents: number;
  phaseoutStartCents: number;
  amortizationMonths: number;
};

/** Expense accounts whose costs are never start-up costs: taxes owed or paid. */
const TAX_ROLES: ReadonlySet<string> = new Set(["TAX_ADJUSTMENTS", "TAX_ABSORBED", "USE_TAX_EXPENSE"]);
/** Schedule C interest lines (16a mortgage, 16b other) — interest is not a start-up cost. */
const INTEREST_LINES: ReadonlySet<string> = new Set(["16a", "16b"]);

export function startupFirstYearCents(totalCents: number, rule: StartupRule): number {
  if (totalCents <= 0) return 0;
  const reduced = Math.max(0, rule.deductionCents - Math.max(0, totalCents - rule.phaseoutStartCents));
  return Math.min(reduced, totalCents);
}

export type StartupYearResult = {
  totalCents: number;
  /** The immediate Section 195 deduction — only in the year the business began. */
  firstYearCents: number;
  /** This year's slice of the remainder's amortization. */
  amortizationCents: number;
  deductionCents: number;
  /** Unamortized remainder at the end of this year. */
  remainingCents: number;
  /** Months of amortization elapsed through the end of this year. */
  monthsElapsed: number;
};

/** The Section 195 result for one tax year. Pure. */
export function startupForYear(
  totalCents: number,
  beganKey: string,
  year: number,
  rule: StartupRule,
): StartupYearResult {
  const beganYear = Number(beganKey.slice(0, 4));
  const beganMonth = Number(beganKey.slice(5, 7));
  const firstYear = startupFirstYearCents(totalCents, rule);
  const remainder = Math.max(0, totalCents - firstYear);
  const monthsThrough = (throughYear: number): number => {
    if (throughYear < beganYear) return 0;
    const elapsed = (throughYear - beganYear) * 12 + (13 - beganMonth);
    return Math.min(Math.max(elapsed, 0), rule.amortizationMonths);
  };
  const amortizedThrough = (throughYear: number): number => {
    const months = monthsThrough(throughYear);
    if (months >= rule.amortizationMonths) return remainder;
    return Math.floor((remainder * months) / rule.amortizationMonths);
  };
  const isBeganYear = year === beganYear;
  const amortization = year < beganYear ? 0 : amortizedThrough(year) - amortizedThrough(year - 1);
  const firstYearPart = isBeganYear ? firstYear : 0;
  return {
    totalCents,
    firstYearCents: firstYearPart,
    amortizationCents: amortization,
    deductionCents: firstYearPart + amortization,
    remainingCents: remainder - amortizedThrough(year),
    monthsElapsed: monthsThrough(year),
  };
}

/**
 * The business-began day: the stored fact when the owner/CPA has set it,
 * otherwise the derived starting value. Null when there is no evidence yet
 * (no appliance, no lead).
 */
export async function resolveBusinessBeganOn(
  db: Db = prisma,
): Promise<{ key: string; stored: boolean } | null> {
  const profile = await db.complianceProfile.findUnique({
    where: { id: "singleton" },
    select: { businessBeganOn: true },
  });
  if (profile?.businessBeganOn) return { key: businessDateKey(profile.businessBeganOn), stored: true };
  const [firstPlaced, firstBought, firstRecorded, firstLead] = await Promise.all([
    db.bookAsset.findFirst({ orderBy: { placedInServiceOn: "asc" }, select: { placedInServiceOn: true } }),
    db.appliance.findFirst({
      where: { purchaseDate: { not: null } },
      orderBy: { purchaseDate: "asc" },
      select: { purchaseDate: true },
    }),
    db.appliance.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.lead.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const candidates = [
    firstPlaced?.placedInServiceOn,
    firstBought?.purchaseDate,
    firstRecorded?.createdAt,
    firstLead?.createdAt,
  ].filter((date): date is Date => date instanceof Date);
  if (candidates.length === 0) return null;
  const earliest = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  return { key: businessDateKey(earliest), stored: false };
}

export type StartupSummary = {
  beganOn: string | null;
  /** True when the date is the stored fact; false for the derived starting value. */
  beganStored: boolean;
  totalCents: number;
  byCategory: { name: string; cents: number }[];
  rule: StartupRule | null;
};

/** All start-up costs: posted expenses dated before the business began. */
export async function computeStartupSummary(db: Db = prisma): Promise<StartupSummary> {
  const began = await resolveBusinessBeganOn(db);
  let rule: StartupRule | null = null;
  const ruleAt = began ? businessDateFromKey(began.key) ?? new Date() : new Date();
  try {
    rule = (await ruleAsOf<StartupRule>("us.startup_costs", ruleAt, db)).value;
  } catch (error) {
    if (!(error instanceof RuleMissingError)) throw error;
  }
  if (!began) return { beganOn: null, beganStored: false, totalCents: 0, byCategory: [], rule };
  const expenses = await db.expense.findMany({
    where: { status: "POSTED", applianceId: null, capitalizeToAppliance: false },
    select: {
      spentOn: true,
      amountCents: true,
      category: {
        select: {
          name: true,
          ledgerAccountId: true,
        },
      },
    },
  });
  const accountById = new Map(
    (await db.ledgerAccount.findMany({ select: { id: true, systemRole: true, scheduleCLine: true } }))
      .map((account) => [account.id, account]),
  );
  let totalCents = 0;
  const byName = new Map<string, number>();
  for (const expense of expenses) {
    if (businessDateKey(expense.spentOn) >= began.key) continue;
    const account = accountById.get(expense.category.ledgerAccountId);
    const role = account?.systemRole ?? null;
    const line = account?.scheduleCLine ?? (role ? deductionMappingForRole(role)?.scheduleCLine ?? null : null);
    if (role && TAX_ROLES.has(role)) continue;
    if (line && INTEREST_LINES.has(line)) continue;
    totalCents += expense.amountCents;
    byName.set(expense.category.name, (byName.get(expense.category.name) ?? 0) + expense.amountCents);
  }
  return {
    beganOn: began.key,
    beganStored: began.stored,
    totalCents,
    byCategory: [...byName.entries()]
      .map(([name, cents]) => ({ name, cents }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rule,
  };
}

export type StartupYearView = StartupYearResult & { beganOn: string; beganStored: boolean };

/** The Section 195 figures for one tax year, or null when nothing applies. */
export async function startupForTaxYear(year: number, db: Db = prisma): Promise<StartupYearView | null> {
  const summary = await computeStartupSummary(db);
  if (!summary.beganOn || !summary.rule) return null;
  if (year < Number(summary.beganOn.slice(0, 4))) return null;
  const result = startupForYear(summary.totalCents, summary.beganOn, year, summary.rule);
  return { ...result, beganOn: summary.beganOn, beganStored: summary.beganStored };
}
