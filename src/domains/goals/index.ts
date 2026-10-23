import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCapability } from "@/domains/capabilities";
import { businessDateKey, businessMonthBounds } from "@/lib/business-date";
import { computeCustodyUtilization, MIN_UTILIZATION_EVIDENCE_DAYS_PER_UNIT } from "@/domains/growth/utilization";
import {
  computePace, GOAL_METRICS, isGoalMetric, validateIdleDays, validateTarget, validateUtilizationPercent,
  type GoalMetric, type Pace,
} from "./pace";

export * from "./pace";

export class GoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalError";
  }
}

export const DEFAULT_IDLE_ALERT_DAYS = 30;
const MAX_IDLE_ROWS = 200;

type Tx = Prisma.TransactionClient;

function daysInColoradoMonth(now: Date): number {
  const [y, m] = businessDateKey(now).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Money received (Receipt, by the day it was received) or rentals started, from the 1st of the Colorado month until now. */
async function actualSoFar(metric: GoalMetric, now: Date): Promise<number> {
  const { start } = businessMonthBounds(now);
  if (metric === "cash") {
    const sum = await prisma.receipt.aggregate({ where: { receivedOn: { gte: start, lte: now } }, _sum: { amountCents: true } });
    return sum._sum.amountCents ?? 0;
  }
  return prisma.rentalAgreement.count({ where: { startDate: { gte: start, lte: now } } });
}

export type GoalProgress = {
  metric: GoalMetric;
  label: string;
  /** Cents for cash, a count for rentals. */
  target: number | null;
  actual: number;
  pace: Pace | null;
};

export async function getGoalProgress(now = new Date()): Promise<GoalProgress[]> {
  const { start } = businessMonthBounds(now);
  const goals = await prisma.businessGoal.findMany({ where: { month: start }, take: 20, orderBy: { id: "asc" } });
  const dayOfMonth = Number(businessDateKey(now).slice(8, 10));
  const daysInMonth = daysInColoradoMonth(now);
  const out: GoalProgress[] = [];
  for (const metric of Object.keys(GOAL_METRICS) as GoalMetric[]) {
    const goal = goals.find((g) => g.metricKey === metric);
    const actual = await actualSoFar(metric, now);
    out.push({
      metric, label: GOAL_METRICS[metric].label, actual, target: goal?.targetValue ?? null,
      pace: goal ? computePace({ target: goal.targetValue, actual, dayOfMonth, daysInMonth }) : null,
    });
  }
  return out;
}

/** Set (or change) this month's target. `target` is cents for cash, a whole number for rentals. */
export async function setMonthlyGoal(actorUserId: string, metricKey: string, target: number, now = new Date()): Promise<void> {
  if (!isGoalMetric(metricKey)) throw new GoalError("Choose money collected or new rentals.");
  const problem = validateTarget(metricKey, target);
  if (problem) throw new GoalError(problem);
  const { start } = businessMonthBounds(now);
  await prisma.$transaction(async (tx) => {
    await assertCapability(tx, actorUserId, "EDIT_SETTINGS");
    const before = await tx.businessGoal.findUnique({ where: { metricKey_month: { metricKey, month: start } }, select: { targetValue: true } });
    await tx.businessGoal.upsert({
      where: { metricKey_month: { metricKey, month: start } },
      create: { metricKey, month: start, targetValue: target, createdByUserId: actorUserId },
      update: { targetValue: target },
    });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "goal.set", entityType: "BusinessGoal", entityId: `${metricKey}:${businessDateKey(start)}`, oldValue: { target: before?.targetValue ?? null }, newValue: { target } },
    });
  });
}

export async function clearMonthlyGoal(actorUserId: string, metricKey: string, now = new Date()): Promise<void> {
  if (!isGoalMetric(metricKey)) throw new GoalError("Choose money collected or new rentals.");
  const { start } = businessMonthBounds(now);
  await prisma.$transaction(async (tx) => {
    await assertCapability(tx, actorUserId, "EDIT_SETTINGS");
    const before = await tx.businessGoal.findUnique({ where: { metricKey_month: { metricKey, month: start } }, select: { targetValue: true } });
    if (!before) return;
    await tx.businessGoal.delete({ where: { metricKey_month: { metricKey, month: start } } });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "goal.clear", entityType: "BusinessGoal", entityId: `${metricKey}:${businessDateKey(start)}`, oldValue: { target: before.targetValue }, newValue: { target: null } },
    });
  });
}

export type AlertSettings = { idleDays: number; utilizationPercent: number | null };

export async function getAlertSettings(): Promise<AlertSettings> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { idleApplianceAlertDays: true, utilizationAlertPercent: true } });
  return { idleDays: row?.idleApplianceAlertDays ?? DEFAULT_IDLE_ALERT_DAYS, utilizationPercent: row?.utilizationAlertPercent ?? null };
}

export async function setAlertSettings(actorUserId: string, next: AlertSettings): Promise<void> {
  const problem = validateIdleDays(next.idleDays) ?? validateUtilizationPercent(next.utilizationPercent);
  if (problem) throw new GoalError(problem);
  await prisma.$transaction(async (tx: Tx) => {
    await assertCapability(tx, actorUserId, "EDIT_SETTINGS");
    const before = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { idleApplianceAlertDays: true, utilizationAlertPercent: true } });
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { idleApplianceAlertDays: next.idleDays, utilizationAlertPercent: next.utilizationPercent } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "settings.alerts", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: { idleDays: before?.idleApplianceAlertDays ?? null, utilizationPercent: before?.utilizationAlertPercent ?? null },
        newValue: { idleDays: next.idleDays, utilizationPercent: next.utilizationPercent },
      },
    });
  });
}

export type IdleAppliance = { id: string; assetNumber: string; typeName: string };

/** Ready-to-rent appliances with no customer custody for `days` days (and at least that old). Capped. */
export async function listIdleAppliances(days: number, now = new Date()): Promise<{ total: number; sample: IdleAppliance[] }> {
  if (days <= 0) return { total: 0, sample: [] };
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const where: Prisma.ApplianceWhereInput = {
    status: "AVAILABLE", archivedAt: null, createdAt: { lt: cutoff },
    custodyEpisodes: { none: { OR: [{ closedAt: null }, { endedOn: { gt: cutoff } }] } },
  };
  const [total, rows] = await Promise.all([
    prisma.appliance.count({ where }),
    prisma.appliance.findMany({ where, select: { id: true, assetNumber: true, applianceType: { select: { name: true } } }, orderBy: [{ assetNumber: "asc" }, { id: "asc" }], take: MAX_IDLE_ROWS }),
  ]);
  return { total, sample: rows.map((r) => ({ id: r.id, assetNumber: r.assetNumber, typeName: r.applianceType.name })) };
}

/** Whole-fleet 30-day utilization as a percent, or null when there is too little history to mean anything. */
export async function getFleetUtilizationPercent(now = new Date()): Promise<number | null> {
  const appliances = await prisma.appliance.findMany({
    where: { archivedAt: null, status: { not: "RETIRED" } },
    select: {
      createdAt: true,
      custodyEpisodes: { where: { OR: [{ closedAt: null }, { endedOn: { gt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }] }, select: { startedOn: true, endedOn: true, closedAt: true } },
    },
    take: 2000, orderBy: { id: "asc" },
  });
  if (appliances.length === 0) return null;
  const u = computeCustodyUtilization(appliances, now);
  if (u.observedDays / appliances.length < MIN_UTILIZATION_EVIDENCE_DAYS_PER_UNIT) return null;
  return Math.round(u.rolling30DayUtilizationFraction * 100);
}
