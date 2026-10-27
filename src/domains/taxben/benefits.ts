import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { ruleAsOf, RuleMissingError } from "@/domains/rules/reads";
import { mileageDeductionCents } from "@/domains/vehicle/rules";
import { allDeductionMappings, businessUsePercentFor, effectiveDeductionPercent } from "./classification";
import { startupForTaxYear } from "./startup";

/**
 * TAXBEN-1 — the tax benefits list (TAX-BENEFITS.md section 3).
 *
 * Computed on read from the books, the fleet, the mileage log and the
 * business facts — the spec's "computed nightly", with no second copy of
 * the numbers to go stale. Every row says what it is in plain words, the
 * estimated amount, the condition the app checked, any deadline, and what
 * the CPA must confirm. Every figure comes from the rule book or the
 * records — never a literal here.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type SeTaxRule = { deductiblePercent: number; ssWageBaseCents: number };
export type SeTaxRates = {
  netEarningsPercent: number;
  socialSecurityPercent: number;
  medicarePercent: number;
  minimumNetEarningsCents: number;
};
export type QbiRule = { percent: number; minimumCents: number; minimumQbiCents: number };

/** Self-employment tax on a year's net profit. Pure. */
export function seTaxCents(netProfitCents: number, rule: SeTaxRule, rates: SeTaxRates): number {
  if (netProfitCents < rates.minimumNetEarningsCents) return 0;
  const netEarnings = Math.round((netProfitCents * rates.netEarningsPercent) / 100);
  const socialSecurity = Math.round((Math.min(netEarnings, rule.ssWageBaseCents) * rates.socialSecurityPercent) / 100);
  const medicare = Math.round((netEarnings * rates.medicarePercent) / 100);
  return socialSecurity + medicare;
}

/** The deductible half (or the rule's share) of the SE tax. Pure. */
export function halfSeTaxCents(seTax: number, rule: SeTaxRule): number {
  return Math.round((seTax * rule.deductiblePercent) / 100);
}

/** SEP-IRA estimate: the rule's share of profit after the SE-tax deduction. Pure. */
export function sepEstimateCents(
  netProfitCents: number,
  halfSeCents: number,
  rule: { percentOfNetProfit: number; maxCents: number },
): number {
  const base = Math.max(0, netProfitCents - halfSeCents);
  return Math.min(rule.maxCents, Math.round((base * rule.percentOfNetProfit) / 100));
}

/** Solo 401(k) estimate: deferral plus the same employer share, capped. Pure. */
export function soloEstimateCents(
  netProfitCents: number,
  halfSeCents: number,
  sepRule: { percentOfNetProfit: number; maxCents: number },
  soloRule: { deferralCents: number; maxTotalCents: number },
): number {
  const employer = sepEstimateCents(netProfitCents, halfSeCents, sepRule);
  return Math.min(soloRule.maxTotalCents, soloRule.deferralCents + employer);
}

/** QBI estimate after the SE-tax, health-insurance and retirement deductions. Pure. */
export function qbiEstimate(input: {
  netProfitCents: number;
  halfSeCents: number;
  seHealthCents: number;
  retirementCents: number;
  rule: QbiRule;
}): { baseCents: number; deductionCents: number } {
  const base = Math.max(
    0,
    input.netProfitCents - input.halfSeCents - input.seHealthCents - input.retirementCents,
  );
  let deduction = Math.round((base * input.rule.percent) / 100);
  if (base >= input.rule.minimumQbiCents) deduction = Math.max(deduction, Math.min(input.rule.minimumCents, base));
  return { baseCents: base, deductionCents: deduction };
}

/** The mid-quarter test: last-quarter share of the year's depreciable basis. Pure. */
export function midQuarterShare(assets: { placedMonth: number; basisCents: number }[]): {
  totalBasisCents: number;
  lastQuarterBasisCents: number;
  sharePercent: number;
} {
  const total = assets.reduce((n, a) => n + a.basisCents, 0);
  const lastQuarter = assets
    .filter((a) => a.placedMonth >= 10)
    .reduce((n, a) => n + a.basisCents, 0);
  return {
    totalBasisCents: total,
    lastQuarterBasisCents: lastQuarter,
    sharePercent: total > 0 ? (lastQuarter * 100) / total : 0,
  };
}

async function ruleOrNull<T>(db: Db, key: Parameters<typeof ruleAsOf>[0], at: Date): Promise<T | null> {
  try {
    return (await ruleAsOf<T>(key, at, db)).value;
  } catch (error) {
    if (error instanceof RuleMissingError) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Year totals from the journal (the same aggregation the Schedule C uses)
// ---------------------------------------------------------------------------

type YearBooks = {
  netProfitCents: number;
  totalIncomeCents: number;
  totalExpensesCents: number;
  byRole: Map<string, { name: string; cents: number }>;
};

async function yearBooks(db: Db, year: number): Promise<YearBooks> {
  const start = businessDateFromKey(`${year}-01-01`)!;
  const end = businessDateFromKey(`${year + 1}-01-01`)!;
  const entries = await db.journalEntry.findMany({
    where: { entryDate: { gte: start, lt: end } },
    select: {
      lines: {
        select: {
          debitCents: true,
          creditCents: true,
          ledgerAccount: { select: { name: true, systemRole: true, type: true } },
        },
      },
    },
  });
  const byRole = new Map<string, { name: string; cents: number }>();
  let totalIncomeCents = 0;
  let totalExpensesCents = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = line.ledgerAccount;
      if (!["INCOME", "CONTRA_INCOME", "EXPENSE"].includes(account.type)) continue;
      const signed =
        account.type === "INCOME" ? line.creditCents - line.debitCents : line.debitCents - line.creditCents;
      if (account.type === "EXPENSE") totalExpensesCents += signed;
      else if (account.type === "CONTRA_INCOME") totalIncomeCents -= signed;
      else totalIncomeCents += signed;
      if (account.systemRole) {
        const existing = byRole.get(account.systemRole);
        if (existing) existing.cents += signed;
        else byRole.set(account.systemRole, { name: account.name, cents: signed });
      }
    }
  }
  return {
    netProfitCents: totalIncomeCents - totalExpensesCents,
    totalIncomeCents,
    totalExpensesCents,
    byRole,
  };
}

// ---------------------------------------------------------------------------
// The benefit list
// ---------------------------------------------------------------------------

export type BenefitRow = {
  key: string;
  title: string;
  whatItIs: string;
  amountCents: number | null;
  amountNote: string | null;
  condition: string;
  deadline: string | null;
  confirm: string;
  details: { label: string; cents: number }[];
};

export type TaxBenefits = {
  year: number;
  netProfitCents: number;
  rows: BenefitRow[];
};

const CPA = "Your CPA confirms this estimate.";

export async function computeTaxBenefits(year: number, db: Db = prisma): Promise<TaxBenefits> {
  const jan1 = businessDateFromKey(`${year}-01-01`)!;
  const dec31 = businessDateFromKey(`${year}-12-31`)!;
  const [books, profile, settings, facts] = await Promise.all([
    yearBooks(db, year),
    db.complianceProfile.findUnique({ where: { id: "singleton" } }),
    db.businessSettings.findUnique({ where: { id: "singleton" } }),
    db.taxYearFacts.findUnique({ where: { year } }),
  ]);
  const businessUsePercents = settings?.businessUsePercents ?? null;
  // The estimates run on the deduction-based profit: a shared or partly
  // personal expense counts only at its deducted percent (the same percent
  // the ordinary-deductions checklist below applies), never at the full
  // journal amount — otherwise answering the business-use question would
  // move the checklist but none of the estimates it feeds. (PR #705 review.)
  let nonDeductedCents = 0;
  for (const [role, total] of books.byRole) {
    const percent = effectiveDeductionPercent(role, businessUsePercents);
    if (percent === null) continue;
    nonDeductedCents += total.cents - Math.round((total.cents * percent) / 100);
  }
  const profit = books.netProfitCents + nonDeductedCents;
  const rows: BenefitRow[] = [];

  // --- Depreciation and expensing -------------------------------------------
  const assets = await db.bookAsset.findMany({
    where: { placedInServiceOn: { gte: jan1, lt: businessDateFromKey(`${year + 1}-01-01`)! } },
    select: {
      costCents: true,
      placedInServiceOn: true,
      appliance: { select: { capDecision: true } },
      taxEvidence: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { section179Cents: true, bonusDepreciationCents: true, allowedDepreciationCents: true },
      },
    },
  });
  let evidenceAllowed = 0;
  let evidenceCount = 0;
  const basisAssets: { placedMonth: number; basisCents: number }[] = [];
  for (const asset of assets) {
    const evidence = asset.taxEvidence[0];
    if (evidence?.allowedDepreciationCents != null) {
      evidenceAllowed += evidence.allowedDepreciationCents;
      evidenceCount += 1;
    }
    // De minimis units are expensed, not depreciated: their cost stays out
    // of the mid-quarter basis even when the books enrolled them.
    if (asset.appliance.capDecision !== "EXPENSED_DE_MINIMIS") {
      basisAssets.push({
        placedMonth: Number(businessDateKey(asset.placedInServiceOn).slice(5, 7)),
        basisCents: asset.costCents - (evidence?.section179Cents ?? 0),
      });
    }
  }
  // The safe-harbor deduction belongs to the purchase's tax year, not the
  // year the classification happened to run.
  const expensedUnits = await db.appliance.findMany({
    where: {
      capDecision: "EXPENSED_DE_MINIMIS",
      purchase: { purchasedOn: { gte: jan1, lt: businessDateFromKey(`${year + 1}-01-01`)! } },
    },
    select: { capLineCents: true },
  });
  const deMinimisTotal = expensedUnits.reduce((n, u) => n + (u.capLineCents ?? 0), 0);
  if (assets.length > 0 || expensedUnits.length > 0) {
    rows.push({
      key: "depreciation",
      title: "Depreciation and expensing",
      whatItIs: "What this year's equipment and appliances wrote off: depreciation on capitalized units, plus small items expensed under the de minimis safe harbor.",
      amountCents: evidenceAllowed + deMinimisTotal,
      amountNote:
        evidenceCount < assets.length
          ? "Some capitalized units have no recorded depreciation evidence yet, so this is a floor, not the full amount."
          : null,
      condition: `${assets.length} capitalized unit(s) placed in service in ${year}; ${expensedUnits.length} unit(s) expensed under the safe harbor (${formatMoney(deMinimisTotal)}).`,
      deadline: null,
      confirm: CPA,
      details: [
        { label: "Depreciation on capitalized units (recorded evidence)", cents: evidenceAllowed },
        { label: "Expensed under the de minimis safe harbor", cents: deMinimisTotal },
      ],
    });
  }

  // --- Mid-quarter watch ------------------------------------------------------
  const midQuarterRule = await ruleOrNull<{ percent: number }>(db, "us.mid_quarter", jan1);
  const share = midQuarterShare(basisAssets);
  if (midQuarterRule && share.totalBasisCents > 0) {
    const over = share.sharePercent > midQuarterRule.percent;
    rows.push({
      key: "mid-quarter",
      title: "Mid-quarter convention watch",
      whatItIs: "If too much of the year's equipment goes into service in the last three months, a mid-quarter rule shrinks first-year depreciation. Buying earlier in the year avoids it.",
      amountCents: null,
      amountNote: null,
      condition: over
        ? `${Math.round(share.sharePercent)}% of ${year}'s depreciable basis was placed in service in the last three months — over the ${midQuarterRule.percent}% line.`
        : `${Math.round(share.sharePercent)}% of ${year}'s depreciable basis was placed in service in the last three months — under the ${midQuarterRule.percent}% line.`,
      deadline: over ? "Before buying more equipment this year, talk to your CPA." : null,
      confirm: CPA,
      details: [],
    });
  }

  // --- Vehicle ----------------------------------------------------------------
  const mileageRule = await ruleOrNull<number>(db, "us.mileage_rate", dec31);
  const trips = await db.mileageTrip.findMany({
    where: { miles: { not: null }, tripDate: { gte: jan1, lt: businessDateFromKey(`${year + 1}-01-01`)! } },
    select: { miles: true },
  });
  const businessMiles = trips.reduce((n, t) => n + (t.miles ?? 0), 0);
  const vehicleActual =
    (books.byRole.get("EXPENSE_FUEL")?.cents ?? 0) +
    (books.byRole.get("EXPENSE_VEHICLE_REPAIRS_AND_MAINTENANCE")?.cents ?? 0) +
    (books.byRole.get("EXPENSE_VEHICLE_INSURANCE")?.cents ?? 0);
  if (businessMiles > 0 || vehicleActual > 0) {
    const mileageAmount = mileageRule !== null ? mileageDeductionCents(businessMiles, mileageRule) : null;
    rows.push({
      key: "vehicle",
      title: "Vehicle: mileage rate vs actual costs",
      whatItIs: "A business vehicle can be deducted two ways: the standard mileage rate on business miles, or the actual running costs. The app works out both; you and your CPA pick one per vehicle.",
      amountCents: mileageAmount,
      amountNote: mileageAmount !== null ? "Mileage-rate amount. Actual costs are in the details." : "The rule book has no mileage rate for this year, so only actual costs are shown.",
      condition: `${businessMiles} business miles logged in ${year}. First-year rule: choose the mileage rate in a vehicle's first business year to keep both options open later — and the mileage rate is not available for a vehicle you claimed bonus depreciation or Section 179 on.`,
      deadline: null,
      confirm: CPA,
      details: [
        { label: "Mileage rate on logged business miles", cents: mileageAmount ?? 0 },
        { label: "Actual costs (fuel, repairs and maintenance, insurance)", cents: vehicleActual },
      ],
    });
  }

  // --- Home office --------------------------------------------------------------
  if (profile?.hasHomeOffice) {
    const simplified = await ruleOrNull<{ rateCentsPerSqFt: number; maxSqFt: number }>(
      db, "us.home_office_simplified", jan1,
    );
    const officeSqFt = profile.homeOfficeSqFt ?? 0;
    const simplifiedAmount =
      simplified !== null ? Math.min(officeSqFt, simplified.maxSqFt) * simplified.rateCentsPerSqFt : null;
    let regularAmount: number | null = null;
    if (profile.homeSqFt && profile.homeOfficeSqFt) {
      const costs =
        (profile.homeHousingCostsCents ?? 0) + (profile.homeUtilitiesCents ?? 0) + (profile.homeInsuranceCents ?? 0);
      regularAmount = Math.round((costs * profile.homeOfficeSqFt) / profile.homeSqFt);
    }
    const attested = profile.homeOfficeAttestedYear === year;
    rows.push({
      key: "home-office",
      title: "Home office",
      whatItIs: "A room used regularly and only for the business can be deducted two ways: the simplified amount per square foot, or the regular method — the office's share of the home's real costs, worked out on the regular-method form.",
      amountCents: Math.max(simplifiedAmount ?? 0, regularAmount ?? 0) || null,
      amountNote: "The larger of the two methods the app can work out from the facts on file.",
      condition: attested
        ? `Exclusive use attested for ${year}.`
        : `The exclusive-use attestation for ${year} has not been recorded yet — the office must be used only for the business.`,
      deadline: null,
      confirm: CPA,
      details: [
        { label: "Simplified method", cents: simplifiedAmount ?? 0 },
        { label: "Regular method (needs the home's costs on file)", cents: regularAmount ?? 0 },
      ],
    });
  }

  // --- Self-employment chain ------------------------------------------------------
  const seRule = await ruleOrNull<SeTaxRule>(db, "us.se_tax", jan1);
  const seRates = await ruleOrNull<SeTaxRates>(db, "us.se_tax_rates", jan1);
  const seTax = seRule && seRates ? seTaxCents(profit, seRule, seRates) : 0;
  const halfSe = seRule ? halfSeTaxCents(seTax, seRule) : 0;
  if (seRule && seRates && profit > 0) {
    rows.push({
      key: "se-tax-half",
      title: "Half of self-employment tax",
      whatItIs: "Half of the owner's self-employment tax is deductible — it is the employer-equivalent share, and it also lowers the income the other estimates below start from.",
      amountCents: halfSe,
      amountNote: `On an estimated self-employment tax of ${formatMoney(seTax)} for ${year}.`,
      condition: `Worked out on the year's tentative profit of ${formatMoney(profit)} at the rule-book rates.`,
      deadline: null,
      confirm: CPA,
      details: [],
    });
  }

  // --- SE health insurance ---------------------------------------------------------
  let seHealthEligible = 0;
  const premiumCents = facts?.seHealthPremiumCents ?? null;
  if (premiumCents !== null && premiumCents > 0) {
    const months = facts?.seHealthEmployerPlanMonths;
    const ineligible = Array.isArray(months) ? months.filter((m) => typeof m === "number").length : 0;
    const eligibleShare = Math.max(0, 12 - ineligible) / 12;
    seHealthEligible = Math.min(Math.round(premiumCents * eligibleShare), Math.max(0, profit));
    rows.push({
      key: "se-health",
      title: "Self-employed health insurance",
      whatItIs: "Health insurance premiums the owner pays can be deducted — except for any month the owner could have joined an employer plan (their own other job's, or a spouse's).",
      amountCents: seHealthEligible,
      amountNote: ineligible > 0 ? `Premiums were entered for the year; ${ineligible} month(s) were marked eligible for an employer plan and are left out.` : "Premiums entered for the year, with no employer-plan months marked.",
      condition: "The monthly employer-plan question lives in Business facts — keep it current and this estimate follows.",
      deadline: null,
      confirm: CPA,
      details: [],
    });
  }

  // --- Retirement ---------------------------------------------------------------------
  const sepRule = await ruleOrNull<{ percentOfNetProfit: number; maxCents: number }>(db, "us.sep_ira", jan1);
  const soloRule = await ruleOrNull<{ deferralCents: number; maxTotalCents: number }>(db, "us.solo_401k", jan1);
  let sepAmount = 0;
  if (sepRule && profit > 0) {
    sepAmount = sepEstimateCents(profit, halfSe, sepRule);
    const soloAmount = soloRule ? soloEstimateCents(profit, halfSe, sepRule, soloRule) : null;
    rows.push({
      key: "retirement",
      title: "Retirement: SEP-IRA vs solo 401(k)",
      whatItIs: "Money the owner puts into a retirement plan is deductible. A SEP-IRA is the simple route; a solo 401(k) usually allows more, because it adds an employee deferral on top of the same employer share.",
      amountCents: sepAmount,
      amountNote: "The SEP-IRA estimate. The solo 401(k) estimate is in the details.",
      condition: `Worked out on tentative profit after the SE-tax deduction. The January-to-March comparison on this page is the time to choose for last year.`,
      deadline:
        "SEP-IRA: set up and fund by the return due date, extensions included. Solo 401(k): a first-year plan must be set up by April 15 with no extensions — your CPA confirms which deadline applies to you.",
      confirm: CPA,
      details: [
        { label: "SEP-IRA estimate", cents: sepAmount },
        { label: "Solo 401(k) estimate", cents: soloAmount ?? 0 },
      ],
    });
  }

  // --- QBI -----------------------------------------------------------------------------
  const qbiRule = await ruleOrNull<QbiRule>(db, "us.qbi", jan1);
  if (qbiRule && profit > 0) {
    const qbi = qbiEstimate({
      netProfitCents: profit,
      halfSeCents: halfSe,
      seHealthCents: seHealthEligible,
      retirementCents: sepAmount,
      rule: qbiRule,
    });
    rows.push({
      key: "qbi",
      title: "Qualified business income (QBI)",
      whatItIs: "A deduction of a share of the business's qualified income, after the SE-tax, health-insurance and retirement deductions above. It does not reduce self-employment tax, only income tax.",
      amountCents: qbi.deductionCents,
      amountNote: `On qualified income of about ${formatMoney(qbi.baseCents)}. Wage and property limits can apply at higher incomes — the CPA checks.`,
      condition: `Worked out from tentative profit of ${formatMoney(profit)}.`,
      deadline: null,
      confirm: CPA,
      details: [],
    });
  }

  // --- Colorado enterprise zone ---------------------------------------------------------
  const ezRule = await ruleOrNull<{ percent: number }>(db, "co.enterprise_zone_credit", jan1);
  const zone = settings?.enterpriseZone ?? "UNKNOWN";
  rows.push({
    key: "enterprise-zone",
    title: "Colorado enterprise zone credit",
    whatItIs: `Parts of Colorado are enterprise zones: equipment bought for use in the zone can earn a state credit of ${ezRule ? ezRule.percent : 0}% of its cost — but the purchase must be pre-certified before you buy, and property expensed under Section 179 does not qualify.`,
    amountCents: null,
    amountNote: null,
    condition:
      zone === "YES"
        ? "The business facts say the business (or its storage address) is inside a zone. Pre-certify in January, before the year's equipment buys."
        : zone === "NO"
          ? "The business facts say the business is not inside a zone, so this credit does not apply."
          : "Whether the business (or its storage address) is inside a zone is not answered yet — check the state's OEDIT map and record the answer in Business facts. Equipment the fleet uses outside the zone likely does not qualify; your CPA confirms.",
    deadline: zone === "YES" ? "Pre-certify in January, before buying equipment." : null,
    confirm: CPA,
    details: [],
  });

  // --- County business personal property --------------------------------------------------
  const bppRule = await ruleOrNull<number>(db, "co.bpp_exemption", jan1);
  if (bppRule !== null) {
    const jan1Next = businessDateFromKey(`${year + 1}-01-01`)!;
    const owned = await db.bookAsset.findMany({
      where: { placedInServiceOn: { lt: jan1Next }, OR: [{ retiredOn: null }, { retiredOn: { gte: jan1Next } }] },
      select: { costCents: true },
    });
    const jan1Value = owned.reduce((n, a) => n + a.costCents, 0);
    rows.push({
      key: "bpp",
      title: "County business personal property",
      whatItIs: "The county taxes business equipment over a yearly exemption. At or under it, no declaration is owed; over it, the declaration is due in the spring.",
      amountCents: null,
      amountNote: null,
      condition: `Equipment on the books for January 1, ${year + 1} totals about ${formatMoney(jan1Value)} against the ${formatMoney(bppRule)} exemption — ${jan1Value <= bppRule ? "under the line, so no declaration on this estimate." : "over the line, so expect to file."} The full county snapshot lives with the filings.`,
      deadline: "Declaration, when owed, is due April 15.",
      confirm: CPA,
      details: [],
    });
  }

  // --- Bad debts -----------------------------------------------------------------------------
  rows.push({
    key: "bad-debts",
    title: "Bad debts and unreturned appliances",
    whatItIs: "On the cash method, rent that was never paid was never counted as income — so there is no bad-debt deduction for it, and the app does not invent one. An appliance a customer never returns is different: its remaining book value may be a loss.",
    amountCents: null,
    amountNote: null,
    condition: "If a unit is never returned, keep its record as it is and tell your CPA — the remaining value on the books is the number they will work from.",
    deadline: null,
    confirm: CPA,
    details: [],
  });

  // --- Losses -----------------------------------------------------------------------------------
  if (profit < 0) {
    rows.push({
      key: "losses",
      title: "Losses and the hobby-loss evidence",
      whatItIs: "A first-year loss is normal for a business buying its fleet. A business loss can carry forward against later years' income (a net operating loss). Losses three years out of five can make the IRS call the activity a hobby — the defense is evidence the business is run like one.",
      amountCents: -profit,
      amountNote: `The ${year} tentative loss. How much carries forward is worked out on the return.`,
      condition: "The evidence is kept automatically: a separate bank account, licenses and registrations in Business records, marketing spending in the books, and the business plan on file.",
      deadline: null,
      confirm: CPA,
      details: [],
    });
  }

  // --- Start-up costs (section 2 module) ---------------------------------------------------------
  const startup = await startupForTaxYear(year, db);
  if (startup && startup.totalCents > 0) {
    rows.push({
      key: "startup",
      title: "Start-up costs",
      whatItIs: "Money spent before the business began is not lost: a first-year amount is deductible right away and the rest is spread over the years that follow.",
      amountCents: startup.deductionCents,
      amountNote: `Of ${formatMoney(startup.totalCents)} in start-up costs from ${startup.beganOn}${startup.beganStored ? "" : " (the began date is still the starting value — your CPA confirms it)"}.`,
      condition: "The full breakdown is on the accountant packet and the depreciation worksheet.",
      deadline: null,
      confirm: CPA,
      details: [
        { label: "First-year deduction", cents: startup.firstYearCents },
        { label: "This year's spread of the rest", cents: startup.amortizationCents },
      ],
    });
  }

  // --- Ordinary deductions checklist ---------------------------------------------------------------
  const checklist: { label: string; cents: number }[] = [];
  let checklistTotal = 0;
  for (const [role, total] of books.byRole) {
    const percent = effectiveDeductionPercent(role, businessUsePercents);
    if (percent === null) continue;
    const deducted = Math.round((total.cents * percent) / 100);
    checklist.push({ label: total.name, cents: deducted });
    checklistTotal += deducted;
  }
  checklist.sort((a, b) => a.label.localeCompare(b.label));
  const zeroAccounts = allDeductionMappings()
    .filter((m) => !books.byRole.has(m.role))
    .map((m) => m.role);
  rows.push({
    key: "ordinary",
    title: "Ordinary deductions checklist",
    whatItIs: "Every expense account in the books, with this year's total after its deduction percent — the ordinary and necessary costs of running the business. Shared accounts deduct only the business-use share you answered.",
    amountCents: checklistTotal,
    amountNote: zeroAccounts.length > 0
      ? `No spending this year on: ${zeroAccounts.length} account(s) that usually have some — missing anything? Check the accounts list in the books.`
      : null,
    condition: "Accounts with no spending this year get a gentle prompt, not a number.",
    deadline: null,
    confirm: CPA,
    details: checklist,
  });

  return { year, netProfitCents: profit, rows };
}

// ---------------------------------------------------------------------------
// Timed To dos fed from the same numbers
// ---------------------------------------------------------------------------

export type BenefitsAttention = {
  kind: "MID_QUARTER" | "RETIREMENT" | "ENTERPRISE_ZONE" | "BUSINESS_USE";
  year: number;
  sharePercent?: number;
  since: Date;
};

export async function listBenefitsAttention(now = new Date(), db: Db = prisma): Promise<BenefitsAttention[]> {
  const key = businessDateKey(now);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const items: BenefitsAttention[] = [];
  if (month === 10 || month === 11) {
    const jan1 = businessDateFromKey(`${year}-01-01`)!;
    const assets = await db.bookAsset.findMany({
      where: { placedInServiceOn: { gte: jan1, lt: businessDateFromKey(`${year + 1}-01-01`)! } },
      select: {
        costCents: true,
        placedInServiceOn: true,
        appliance: { select: { capDecision: true } },
        taxEvidence: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { section179Cents: true },
        },
      },
    });
    const share = midQuarterShare(
      assets
        .filter((a) => a.appliance.capDecision !== "EXPENSED_DE_MINIMIS")
        .map((a) => ({
          placedMonth: Number(businessDateKey(a.placedInServiceOn).slice(5, 7)),
          basisCents: a.costCents - (a.taxEvidence[0]?.section179Cents ?? 0),
        })),
    );
    const rule = await ruleOrNull<{ percent: number }>(db, "us.mid_quarter", jan1);
    if (rule && share.totalBasisCents > 0 && share.sharePercent > rule.percent) {
      items.push({ kind: "MID_QUARTER", year, sharePercent: Math.round(share.sharePercent), since: now });
    }
  }
  if (month >= 1 && month <= 3) {
    items.push({ kind: "RETIREMENT", year, since: now });
  }
  if (month === 1) {
    const settings = await db.businessSettings.findUnique({
      where: { id: "singleton" }, select: { enterpriseZone: true },
    });
    if (settings?.enterpriseZone === "YES") {
      items.push({ kind: "ENTERPRISE_ZONE", year, since: now });
    }
  }
  const settings = await db.businessSettings.findUnique({
    where: { id: "singleton" }, select: { businessUsePercents: true },
  });
  const unanswered = allDeductionMappings().some(
    (entry) =>
      entry.mapping.kind === "PERSONAL_SHARE" &&
      businessUsePercentFor(settings?.businessUsePercents ?? null, entry.role) === null,
  );
  if (unanswered) items.push({ kind: "BUSINESS_USE", year, since: now });
  return items;
}
