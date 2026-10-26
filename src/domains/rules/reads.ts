import type { LegalRuleVersion, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ORIGIN_PRIORITY, RULE_KEYS, ruleDef, type RuleKey } from "./registry";

/**
 * TFA-1: dated reads over LegalRuleVersion (TAX-FEE-AUTOPILOT section 2).
 * `ruleAsOf` is the version in force on a date: the newest start date at or
 * before it, undone versions excluded; when two versions share a start date
 * the origin priority decides (PROFESSIONAL > OWNER > OFFICIAL_WATCH >
 * RESEARCHED). The `db` parameter accepts the Prisma client or a transaction
 * client, so callers inside a transaction read their own writes.
 */

export type RuleDb = PrismaClient | Prisma.TransactionClient;

export class RuleMissingError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`No rule version for ${key} on that date.`);
    this.name = "RuleMissingError";
    this.key = key;
  }
}

export type RuleVersion = LegalRuleVersion;

function pickByOrigin(rows: LegalRuleVersion[]): LegalRuleVersion | undefined {
  return rows.reduce<LegalRuleVersion | undefined>((best, row) =>
    !best || (ORIGIN_PRIORITY[row.origin] ?? 0) > (ORIGIN_PRIORITY[best.origin] ?? 0) ? row : best, undefined);
}

export async function ruleAsOf<T>(
  key: RuleKey, at: Date, db: RuleDb = prisma,
): Promise<{ value: T; version: LegalRuleVersion }> {
  const def = ruleDef(key);
  // At most one row per origin shares a start date (unique index), so four
  // rows cover every candidate at the newest start date.
  const rows = await db.legalRuleVersion.findMany({
    where: { ruleKey: key, effectiveFrom: { lte: at }, undoneAt: null },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    take: 4,
  });
  const top = rows[0]?.effectiveFrom.getTime();
  const picked = top === undefined ? undefined :
    pickByOrigin(rows.filter((row) => row.effectiveFrom.getTime() === top));
  if (!picked) throw new RuleMissingError(key);
  return { value: def.schema.parse(picked.value) as T, version: picked };
}

export async function nextRuleChange(
  key: RuleKey, after: Date, db: RuleDb = prisma,
): Promise<LegalRuleVersion | null> {
  const rows = await db.legalRuleVersion.findMany({
    where: { ruleKey: key, effectiveFrom: { gt: after }, undoneAt: null },
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    take: 4,
  });
  const first = rows[0]?.effectiveFrom.getTime();
  if (first === undefined) return null;
  return pickByOrigin(rows.filter((row) => row.effectiveFrom.getTime() === first)) ?? null;
}

export async function listRuleHistory(key: RuleKey, db: RuleDb = prisma): Promise<LegalRuleVersion[]> {
  return db.legalRuleVersion.findMany({
    where: { ruleKey: key },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

export type RuleCard = {
  key: RuleKey;
  current: { value: unknown; version: LegalRuleVersion } | null;
  next: LegalRuleVersion | null;
};

/** One card per registry rule for the Taxes > Rules screen. */
export async function listRuleCards(db: RuleDb = prisma, at: Date = new Date()): Promise<RuleCard[]> {
  const cards: RuleCard[] = [];
  for (const key of RULE_KEYS) {
    const [current, next] = await Promise.all([
      ruleAsOf(key, at, db).catch((error) => {
        if (error instanceof RuleMissingError) return null;
        throw error;
      }),
      nextRuleChange(key, at, db),
    ]);
    cards.push({ key, current, next });
  }
  return cards;
}

export const DEFAULT_TIMING_PERCENT = 90;
export const DEFAULT_TIMING_MARGIN_DAYS = 3;

/** Owner timing settings for changes that cost the business (section 3). */
export async function getRuleTimingSettings(db: RuleDb = prisma): Promise<{
  percent: number;
  marginBusinessDays: number;
}> {
  const settings = await db.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { costlyChangeTimingPercent: true, timingSafetyMarginBusinessDays: true },
  });
  const percent = settings?.costlyChangeTimingPercent ?? DEFAULT_TIMING_PERCENT;
  const marginBusinessDays = settings?.timingSafetyMarginBusinessDays ?? DEFAULT_TIMING_MARGIN_DAYS;
  return {
    percent: percent >= 85 && percent <= 95 ? percent : DEFAULT_TIMING_PERCENT,
    marginBusinessDays: marginBusinessDays >= 1 && marginBusinessDays <= 10 ? marginBusinessDays : DEFAULT_TIMING_MARGIN_DAYS,
  };
}
