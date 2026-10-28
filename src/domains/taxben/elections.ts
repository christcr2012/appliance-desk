import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { ruleAsOf, RuleMissingError } from "@/domains/rules/reads";
import { getPolicyState } from "./policy";
import { deMinimisElectionFor } from "./classification";
import { computeStartupSummary, startupForYear } from "./startup";
import { computeTaxBenefits } from "./benefits";

type Db = PrismaClient | Prisma.TransactionClient;

// TAXBEN-2: the year's election statements for the accountant packet, the
// bonus elect-out choice (owner / admin / accountant, audited), and the
// November 15 year-end planning To do facts.
//
// A packet snapshot may never carry a full tax ID (prepareFiling asserts
// it), so every statement identifies the business by name, address and the
// EIN's last four — the full EIN lives on the filed return itself.

async function ruleOrNull<T>(db: Db, key: Parameters<typeof ruleAsOf>[0], at: Date): Promise<T | null> {
  try {
    return (await ruleAsOf<T>(key, at, db)).value;
  } catch (error) {
    if (error instanceof RuleMissingError) return null;
    throw error;
  }
}

/** The class keys the rule book knows, with their display labels for a year. */
export async function bonusClassOptions(
  db: Db,
  year: number,
): Promise<{ key: string; label: string; months: number }[]> {
  const jan1 = businessDateFromKey(`${year}-01-01`) ?? new Date();
  const lives = await ruleOrNull<Record<string, number>>(db, "us.class_life_months", jan1);
  if (!lives) return [];
  const names: Record<string, string> = {
    rentalAppliances: "rental appliances",
    tools: "tools",
  };
  return Object.entries(lives)
    .filter(([, months]) => Number.isSafeInteger(months) && months > 0)
    .map(([key, months]) => ({
      key,
      months,
      label: `${Math.round(months / 12)}-year property (${names[key] ?? key})`,
    }))
    .sort((a, b) => a.months - b.months);
}

/** The elect-out classes stored for a year (validated class keys only). */
export async function bonusElectOutClasses(db: Db, year: number): Promise<string[]> {
  const facts = await db.taxYearFacts.findUnique({
    where: { year },
    select: { bonusElectOutClasses: true },
  });
  const stored = facts?.bonusElectOutClasses;
  if (!Array.isArray(stored)) return [];
  return stored.filter((c): c is string => typeof c === "string");
}

/**
 * Save the year's bonus elect-out choice. The owner, an admin or the
 * accountant may set it (ACCT-1: the accountant edits the elections; the
 * change is audited under their own name and listed for the owner). Any
 * other role is refused. An empty list clears the choice.
 */
export async function saveBonusElectOut(
  actorId: string,
  year: number,
  classes: string[],
): Promise<void> {
  if (!Number.isSafeInteger(year) || String(year).length !== 4)
    throw new Error("That year could not be read.");
  if (!Array.isArray(classes) || classes.some((c) => typeof c !== "string"))
    throw new Error("The elect-out classes look wrong — check them and try again.");
  const wanted = [...new Set(classes)];
  const options = await bonusClassOptions(prisma, year);
  const known = new Set(options.map((o) => o.key));
  if (wanted.some((c) => !known.has(c)))
    throw new Error("One of those property classes is not in the rule book for that year.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN", "ACCOUNTANT"]);
    const existing = await tx.taxYearFacts.findUnique({ where: { year } });
    if (existing) {
      await tx.$queryRaw`SELECT "id" FROM "TaxYearFacts" WHERE "id" = ${existing.id} FOR UPDATE`;
    }
    const previous = await bonusElectOutClasses(tx, year);
    if (existing) {
      await tx.taxYearFacts.update({
        where: { year },
        data: { bonusElectOutClasses: wanted.length ? wanted : Prisma.DbNull },
      });
    } else {
      await tx.taxYearFacts.create({
        data: { year, bonusElectOutClasses: wanted.length ? wanted : Prisma.DbNull },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "taxben.elections.save",
        entityType: "TaxYearFacts",
        entityId: String(year),
        oldValue: { bonusElectOutClasses: previous },
        newValue: { bonusElectOutClasses: wanted },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Statement texts (pure)
// ---------------------------------------------------------------------------

function taxpayerLine(input: {
  businessName: string;
  address: string | null;
  einLast4: string | null;
}): string {
  const ein = input.einLast4 ? `EIN ending ${input.einLast4}` : "EIN not on file";
  return [input.businessName, input.address, ein].filter(Boolean).join(" — ");
}

export function deMinimisStatementText(input: {
  businessName: string;
  address: string | null;
  einLast4: string | null;
  limitCents: number | null;
  year: number;
}): string {
  const limit =
    input.limitCents !== null ? formatMoney(input.limitCents) : "the limit in the regulation";
  return [
    `De minimis safe harbor election — ${input.year}`,
    taxpayerLine(input),
    "",
    `Under Treasury Regulation section 1.263(a)-1(f), ${input.businessName} elects the de minimis safe harbor for the ${input.year} tax year. Under the election, the business deducts amounts paid to acquire or produce tangible property up to ${limit} per invoice or item, as permitted by its written capitalization policy in effect at the start of ${input.year}.`,
    "",
    `Prepared for the business's accountant to attach to the ${input.year} return. The full EIN appears on the return itself.`,
  ].join("\n");
}

export function electOutStatementText(input: {
  businessName: string;
  address: string | null;
  einLast4: string | null;
  classLabels: string[];
  year: number;
}): string {
  return [
    `Election out of bonus depreciation — ${input.year}`,
    taxpayerLine(input),
    "",
    `Under Internal Revenue Code section 168(k)(7), ${input.businessName} elects not to deduct bonus depreciation for the following classes of property placed in service during ${input.year}: ${input.classLabels.join("; ")}. Property in these classes is depreciated under the regular rules instead.`,
    "",
    `Prepared for the business's accountant to attach to the ${input.year} return.`,
  ].join("\n");
}

export function startupNoteText(input: {
  businessName: string;
  beganOn: string;
  beganStored: boolean;
  totalCents: number;
  firstYearCents: number;
  amortizationCents: number;
  remainingCents: number;
  amortizationMonths: number;
  year: number;
}): string {
  return [
    `Start-up costs — Section 195 note for ${input.year}`,
    `${input.businessName} began business on ${input.beganOn}${input.beganStored ? "" : " (a starting value — the CPA confirms the date)"}. Start-up costs from before that date total ${formatMoney(input.totalCents)}.`,
    "",
    `Under Section 195 the business is treated as electing to deduct start-up costs up to the rule-book limit in its first year and to amortize the rest over ${input.amortizationMonths} months beginning the month the business began. For ${input.year}: first-year deduction ${formatMoney(input.firstYearCents)}, amortization ${formatMoney(input.amortizationCents)}, still to amortize after ${input.year} ${formatMoney(input.remainingCents)}.`,
    "",
    "Estimates from the posted books — the business's CPA confirms.",
  ].join("\n");
}

/**
 * The return due date key for a tax year, from the entity type — the same
 * calendar rule the compliance registry uses for the return period
 * (partnerships and S-corps: March 15; everyone else: April 15, of the
 * following year). The packet itself always carries the filing's own due
 * date; this is for previews away from a filing.
 */
export function returnDueKey(entityType: string | null | undefined, year: number): string {
  const partnershipOrCorp = entityType === "MULTI_MEMBER_LLC" || entityType === "S_CORP";
  return partnershipOrCorp ? `${year + 1}-03-15` : `${year + 1}-04-15`;
}

/** The extension deadline: six calendar months after the due date key. */
export function extensionKeyFor(dueKey: string): string {
  const year = Number(dueKey.slice(0, 4));
  const month = Number(dueKey.slice(5, 7));
  const day = Number(dueKey.slice(8, 10));
  const total = year * 12 + (month - 1) + 6;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The packet block
// ---------------------------------------------------------------------------

export type ElectionStatements = {
  year: number;
  dueOnKey: string;
  extensionKey: string;
  deMinimisIncluded: boolean;
  deMinimisText: string;
  electOutClasses: string[];
  electOutText: string | null;
  startupNoteText: string | null;
};

/**
 * Build the year's election statements for the accountant packet. The due
 * date is the filing's own (from the compliance calendar); the extension
 * date is six months later. The de minimis statement rides only when the
 * year's capitalization policy is signed — an unsigned year gets a plain
 * not-included line instead of a silent gap.
 */
export async function buildElectionStatements(
  db: Db,
  year: number,
  dueKey: string,
): Promise<ElectionStatements> {
  const jan1 = businessDateFromKey(`${year}-01-01`) ?? new Date();
  const [profile, settingsRow, policy, limitCents, options, chosen, startup] = await Promise.all([
    db.complianceProfile.findUnique({
      where: { id: "singleton" },
      select: { businessLegalName: true, businessAddress: true, einLast4: true },
    }),
    db.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { deMinimisElections: true },
    }),
    getPolicyState(db, year),
    ruleOrNull<number>(db, "us.de_minimis_per_item", jan1),
    bonusClassOptions(db, year),
    bonusElectOutClasses(db, year),
    computeStartupSummary(db),
  ]);
  const businessName = profile?.businessLegalName ?? "Robinson Appliance Rentals";
  const identity = {
    businessName,
    address: profile?.businessAddress ?? null,
    einLast4: profile?.einLast4 ?? null,
  };
  const electionOn = deMinimisElectionFor(settingsRow?.deMinimisElections, year);
  const deMinimisIncluded = electionOn && policy.status === "SIGNED";
  const deMinimisText = deMinimisIncluded
    ? deMinimisStatementText({ ...identity, limitCents, year })
    : !electionOn
      ? `Not applicable for ${year}: the de minimis safe harbor election is switched off for this year in Write-off settings, so no election statement is needed.`
      : `Not included for ${year} yet: the de minimis safe harbor statement rides on this packet once the year's capitalization policy is signed on Taxes > Tax benefits.`;
  const chosenOptions = options.filter((o) => chosen.includes(o.key));
  const electOutText = chosenOptions.length
    ? electOutStatementText({
        ...identity,
        classLabels: chosenOptions.map((o) => o.label),
        year,
      })
    : null;
  let startupNote: string | null = null;
  if (startup.beganOn && startup.rule && startup.totalCents > 0) {
    const result = startupForYear(startup.totalCents, startup.beganOn, year, startup.rule);
    const beganYear = Number(startup.beganOn.slice(0, 4));
    if (year >= beganYear && (result.deductionCents > 0 || year === beganYear)) {
      startupNote = startupNoteText({
        businessName,
        beganOn: startup.beganOn,
        beganStored: startup.beganStored,
        totalCents: startup.totalCents,
        firstYearCents: result.firstYearCents,
        amortizationCents: result.amortizationCents,
        remainingCents: result.remainingCents,
        amortizationMonths: startup.rule.amortizationMonths,
        year,
      });
    }
  }
  return {
    year,
    dueOnKey: dueKey,
    extensionKey: extensionKeyFor(dueKey),
    deMinimisIncluded,
    deMinimisText,
    electOutClasses: chosenOptions.map((o) => o.label),
    electOutText,
    startupNoteText: startupNote,
  };
}

// ---------------------------------------------------------------------------
// The November 15 year-end planning To do facts
// ---------------------------------------------------------------------------

export type YearEndPlanningAttention = {
  year: number;
  since: Date;
  profitCents: number;
  sepCents: number | null;
  soloCents: number | null;
  midQuarterNote: string | null;
  deMinimisExpensedCents: number | null;
};

/**
 * From November 15 through December 31 (Denver), the year-end planning
 * facts for the current year: tentative profit, the retirement room on
 * that profit, the mid-quarter status and the safe-harbor expensed total —
 * information for the owner and the CPA, never advice to buy.
 */
export async function listYearEndPlanningAttention(
  now = new Date(),
  db: Db = prisma,
): Promise<YearEndPlanningAttention[]> {
  const key = businessDateKey(now);
  const year = Number(key.slice(0, 4));
  if (key < `${year}-11-15` || key > `${year}-12-31`) return [];
  const benefits = await computeTaxBenefits(year, db);
  const retirement = benefits.rows.find((r) => r.key === "retirement");
  const detail = (label: string) =>
    retirement?.details.find((d) => d.label === label)?.cents ?? null;
  const midQuarter = benefits.rows.find((r) => r.key === "mid-quarter");
  const depreciation = benefits.rows.find((r) => r.key === "depreciation");
  const expensed = depreciation?.details.find(
    (d) => d.label === "Expensed under the de minimis safe harbor",
  )?.cents;
  return [
    {
      year,
      since: businessDateFromKey(`${year}-11-15`) ?? now,
      profitCents: benefits.netProfitCents,
      sepCents: detail("SEP-IRA estimate"),
      soloCents: detail("Solo 401(k) estimate"),
      midQuarterNote: midQuarter?.condition ?? null,
      deMinimisExpensedCents: expensed ?? null,
    },
  ];
}
