import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { communicationsPolicySchema } from "./communications-policy";

/**
 * COM-N4: observed service numbers, cost per customer and forecasts. Read-only: it never sends, posts or changes anything.
 * Anything that cannot be worked out honestly (no customers, no history, a zero denominator) is `null`, never zero and never guessed.
 */
const DAY = 86_400_000;
/** Recommended starting values. The owner can change all three in Settings; "restore recommended" puts these back. */
export const FORECAST_SCENARIOS: readonly number[] = [200, 250, 500, 1000];
/** At least this many customer-days of history before a forecast is shown. */
export const MIN_FORECAST_CUSTOMER_DAYS = 14;
/** At least this many resolved texts before a failure rate is shown. */
export const MIN_RATE_SAMPLE = 10;
export type ServiceReportingSettings = { forecastScenarios: readonly number[]; minForecastCustomerDays: number; minRateSample: number };
export const RECOMMENDED_SERVICE_REPORTING: ServiceReportingSettings = Object.freeze({
  forecastScenarios: FORECAST_SCENARIOS, minForecastCustomerDays: MIN_FORECAST_CUSTOMER_DAYS, minRateSample: MIN_RATE_SAMPLE });

/** Phone-number rental charges recur no matter how many customers there are; only these provider categories count as fixed. */
const FIXED_CATEGORIES = ["phonenumbers-local", "phonenumbers-mobile"] as const;
/** Fixed recurring cents from a provider breakdown, or null when the breakdown cannot be trusted (unknown or unpriced parts, or no breakdown at all). */
export function fixedChargeCents(usage: { breakdownCents: Record<string, number>; unknownCategories: readonly string[]; incompleteComponents: readonly string[] }): number | null {
  if (usage.unknownCategories.length > 0 || usage.incompleteComponents.length > 0 || Object.keys(usage.breakdownCents).length === 0) return null;
  return FIXED_CATEGORIES.reduce((n, c) => n + (usage.breakdownCents[c] ?? 0), 0);
}

export type AgreementSpan = {
  customerId: string; status: "DRAFT" | "AWAITING_SIGNATURE" | "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";
  startDate: Date | null; closedAt: Date | null;
};
export type ActiveCustomerDays = {
  /** Total of (distinct customers with an ACTIVE agreement) over each day. */
  customerDays: number; days: number; averageDaily: number | null;
  /** False when an ended agreement has no recorded end time, so history cannot be trusted. */
  complete: boolean;
};

function dayStart(d: Date): number { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }

/** Whole GMT days from `from` through `to` inclusive (the same days the provider bills by). */
export function activeCustomerDays(spans: readonly AgreementSpan[], from: Date, to: Date): ActiveCustomerDays {
  const start = dayStart(from), end = dayStart(to);
  if (!(end >= start)) return { customerDays: 0, days: 0, averageDaily: null, complete: false };
  const days = Math.round((end - start) / DAY) + 1;
  let complete = true;
  const perDay = new Array<Set<string>>(days);
  for (let i = 0; i < days; i++) perDay[i] = new Set();
  for (const s of spans) {
    if (s.status === "DRAFT" || s.status === "AWAITING_SIGNATURE" || s.status === "SCHEDULED") continue;
    if (!s.startDate) { if (s.status !== "CANCELLED") complete = false; continue; }
    if ((s.status === "ENDED" || s.status === "CANCELLED") && !s.closedAt) { complete = false; continue; }
    const first = Math.max(dayStart(s.startDate), start);
    // A closed agreement counts through the day before it closed (it was not in force on the day it ended).
    const last = Math.min(s.closedAt ? dayStart(s.closedAt) - DAY : end, end);
    for (let t = first; t <= last; t += DAY) perDay[Math.round((t - start) / DAY)].add(s.customerId);
  }
  const customerDays = perDay.reduce((n, set) => n + set.size, 0);
  return { customerDays, days, averageDaily: complete && customerDays > 0 ? customerDays / days : null, complete };
}

export function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || !(denominator > 0)) return null;
  return numerator / denominator;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type Forecast =
  | { available: false; reason: string }
  | { available: true; variableCentsPerCustomerDay: number; fixedCents: number; customerDays: number; days: number;
      scenarios: { customers: number; monthlyCents: number }[]; limitations: string[] };

/**
 * Observed variable spend per customer-day, scaled to each scenario for a 30-day month, plus known fixed recurring
 * charges once (never scaled, never double counted). Scenarios are editable what-ifs, not budget facts.
 */
export function forecastSpend(input: {
  totalCents: number | null; fixedCents: number | null; complete: boolean; customerDays: number; days: number;
  scenarios?: readonly number[]; minCustomerDays?: number;
}): Forecast {
  if (input.totalCents === null || input.fixedCents === null) return { available: false, reason: "Provider spend is not fully known for this period." };
  if (!input.complete) return { available: false, reason: "Customer history for this period is incomplete." };
  if (input.customerDays < (input.minCustomerDays ?? MIN_FORECAST_CUSTOMER_DAYS)) return { available: false, reason: "Not enough customer history yet to forecast." };
  const variable = Math.max(0, input.totalCents - input.fixedCents);
  const perDay = variable / input.customerDays;
  return {
    available: true, variableCentsPerCustomerDay: perDay, fixedCents: input.fixedCents, customerDays: input.customerDays, days: input.days,
    scenarios: (input.scenarios ?? FORECAST_SCENARIOS).map((customers) => ({
      customers, monthlyCents: Math.round(perDay * customers * 30 + input.fixedCents!) })),
    limitations: ["Volume discounts and new features are not assumed.", "Provider-reported, not invoice reconciled.",
      "Fixed charges are counted once."],
  };
}

export type ServiceMetrics = {
  window: { fromGMT: string; throughGMT: string };
  texts: { delivered: number; failed: number; pending: number; unknown: number; resolved: number;
    failureRate: number | null; sampleEnough: boolean };
  optOuts: { count: number; contacted: number; rate: number | null };
  response: { medianMinutes: number | null; samples: number };
  customers: ActiveCustomerDays;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Owner/Admin only. Window is whole GMT days, inclusive, so it lines up with the provider's own billing days. */
export async function getServiceMetrics(actorUserId: string, from: Date, to: Date, settings: ServiceReportingSettings = RECOMMENDED_SERVICE_REPORTING): Promise<ServiceMetrics> {
  const start = new Date(dayStart(from)), end = new Date(dayStart(to) + DAY);
  if (!(+end > +start) || +end - +start > 93 * DAY) throw new Error("INVALID_METRICS_WINDOW");
  await prisma.$transaction((tx) => assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]));
  const [deliveries, suppressions, inbound, agreements] = await Promise.all([
    prisma.messageDelivery.findMany({ where: { channel: "SMS", requestedAt: { gte: start, lt: end }, environment: "PRODUCTION" },
      select: { state: true, recipientAddress: true }, take: 20001 }),
    prisma.marketingSuppression.findMany({ where: { channel: "SMS", createdAt: { gte: start, lt: end } }, select: { address: true }, take: 5001 }),
    prisma.communicationMessage.findMany({ where: { direction: "INBOUND", occurredAt: { gte: start, lt: end } },
      select: { threadId: true, occurredAt: true }, orderBy: { occurredAt: "asc" }, take: 5001 }),
    prisma.rentalAgreement.findMany({ where: { OR: [{ status: "ACTIVE" }, { closedAt: { gte: start } }, { status: { in: ["ENDED", "CANCELLED"] }, closedAt: null }] },
      select: { customerId: true, status: true, startDate: true, closedAt: true }, take: 20001 }),
  ]);
  const count = (s: string) => deliveries.filter((d) => d.state === s).length;
  const delivered = count("DELIVERED"), failed = count("FAILED") + count("BOUNCED");
  const pending = count("PENDING") + count("ACCEPTED"), unknown = count("UNKNOWN");
  const resolved = delivered + failed;
  const contacted = new Set(deliveries.filter((d) => d.state !== "NOT_SENT" && d.state !== "SUPPRESSED").map((d) => d.recipientAddress));
  const optOutAddresses = new Set(suppressions.map((s) => s.address));
  const optOutCount = [...optOutAddresses].filter((a) => contacted.has(a)).length;

  // First authorized human reply (a person's own outbound message) after each inbound message, per thread.
  const times: number[] = [];
  const threads = [...new Set(inbound.map((m) => m.threadId))].slice(0, 500);
  if (threads.length) {
    const replies = await prisma.communicationMessage.findMany({ where: { threadId: { in: threads }, direction: "OUTBOUND",
      actorUserId: { not: null }, occurredAt: { gte: start },
      // A reply that failed, was stopped or never left the building is not a response.
      delivery: { state: { in: ["ACCEPTED", "DELIVERED"] } } }, select: { threadId: true, occurredAt: true }, orderBy: { occurredAt: "asc" }, take: 5001 });
    const byThread = new Map<string, Date[]>();
    for (const r of replies) byThread.set(r.threadId, [...(byThread.get(r.threadId) ?? []), r.occurredAt]);
    const answered = new Set<string>();
    for (const m of inbound) {
      if (!threads.includes(m.threadId) || answered.has(m.threadId)) continue;
      const next = (byThread.get(m.threadId) ?? []).find((t) => +t > +m.occurredAt);
      if (next) { times.push((+next - +m.occurredAt) / 60_000); answered.add(m.threadId); }
    }
  }
  return {
    window: { fromGMT: iso(start), throughGMT: iso(new Date(+end - DAY)) },
    texts: { delivered, failed, pending, unknown, resolved,
      failureRate: resolved >= settings.minRateSample ? ratio(failed, resolved) : null, sampleEnough: resolved >= settings.minRateSample },
    optOuts: { count: optOutCount, contacted: contacted.size, rate: contacted.size >= settings.minRateSample ? ratio(optOutCount, contacted.size) : null },
    response: { medianMinutes: median(times), samples: times.length },
    customers: activeCustomerDays(agreements, start, new Date(+end - DAY)),
  };
}

export async function getServiceReportingSettings(): Promise<ServiceReportingSettings> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { communicationsPolicy: true } });
  const parsed = communicationsPolicySchema.safeParse(row?.communicationsPolicy);
  const saved = parsed.success ? parsed.data.serviceReporting : undefined;
  return saved ? { forecastScenarios: [...saved.forecastScenarios].sort((a, b) => a - b), minForecastCustomerDays: saved.minForecastCustomerDays,
    minRateSample: saved.minRateSample } : RECOMMENDED_SERVICE_REPORTING;
}
