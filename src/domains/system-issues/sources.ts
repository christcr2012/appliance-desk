import { ProviderOperationKind } from "@prisma/client";
import { businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { AUTOMATION_RULES } from "@/domains/automation/health";
import { recordSystemIssue, resolveSystemIssue, type SystemIssueInput } from ".";

type SourcePage = {
  issues: SystemIssueInput[];
  clearFingerprints: string[];
  nextCursor: string | null;
};
const ONE_HOUR = 60 * 60 * 1000;
const validLimit = (n: number) => Number.isInteger(n) && n > 0 && n <= 500;
const noCustomerData = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** A bounded read-only snapshot. A partial watch page never clears unseen issues. */
export async function collectSystemIssueInputs(
  now: Date,
  input: { limit: number; cursor?: string },
): Promise<SourcePage> {
  if (!validLimit(input.limit)) throw new Error("System health scan size must be 1–500.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid scan date.");
  if (input.cursor && !/^watch:[a-zA-Z0-9_-]{1,128}$/.test(input.cursor)) throw new Error("Invalid scan cursor.");

  const issues: SystemIssueInput[] = [];
  const cleared = new Set<string>();
  if (!input.cursor) {
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { pausedAutomations: true },
    });
    const paused = new Set(noCustomerData(settings?.pausedAutomations));
    for (const rule of AUTOMATION_RULES) {
      // The system health sweep cannot recursively warn about its own issue write.
      if (rule.ruleKey === "system-issues-sweep") continue;
      const missing = rule.requiredEnv.filter((name) => !process.env[name]);
      if (paused.has(rule.ruleKey)) {
        cleared.add("automation-stale:" + rule.ruleKey);
        cleared.add("config:" + rule.ruleKey);
        continue;
      }
      if (missing.length > 0) {
        issues.push({ kind: "CONFIGURATION_MISSING", ruleKey: rule.ruleKey,
          missingVariableNames: missing });
      } else {
        cleared.add("config:" + rule.ruleKey);
      }
      const latest = await prisma.automationRun.findFirst({
        where: { ruleKey: rule.ruleKey },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { id: true, state: true, startedAt: true },
      });
      // No historical run != evidence that an active daily task is overdue.
      if (!latest) continue;
      if (latest.state === "SUCCEEDED") {
        cleared.add("automation:" + rule.ruleKey);
      } else if (latest.state === "FAILED") {
        issues.push({ kind: "AUTOMATION_FAILED", ruleKey: rule.ruleKey,
          runId: latest.id, startedAt: latest.startedAt, errorName: "UnknownError" });
      }
      const lastSuccess = await prisma.automationRun.findFirst({
        where: { ruleKey: rule.ruleKey, state: "SUCCEEDED" },
        orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
        select: { finishedAt: true, startedAt: true },
      });
      const successAt = lastSuccess?.finishedAt ?? lastSuccess?.startedAt ?? null;
      if (latest.state === "FAILED") {
        cleared.add("automation-stale:" + rule.ruleKey);
      } else if (successAt && now.getTime() - successAt.getTime() > rule.expectedEveryHours * 2 * ONE_HOUR) {
        issues.push({ kind: "AUTOMATION_STALE", ruleKey: rule.ruleKey,
          lastSuccessAt: successAt, expectedEveryHours: rule.expectedEveryHours });
      } else {
        cleared.add("automation-stale:" + rule.ruleKey);
      }
    }
  }
  if (!input.cursor) {
    // Provider status is never inferred from retries or missing webhooks. A
    // complete grouped query is authoritative for the scoped old operations.
    const oldOperations = await prisma.providerOperation.groupBy({
      by: ["kind"],
      where: { status: { in: ["PENDING", "UNKNOWN", "DRIFT"] },
        requestedAt: { lte: new Date(now.getTime() - 24 * ONE_HOUR) } },
      _count: { _all: true }, _min: { requestedAt: true },
    });
    const present = new Set<string>();
    for (const row of oldOperations) {
      present.add(row.kind);
      if (row._min.requestedAt) issues.push({
        kind: "PROVIDER_OPERATION_STUCK", operationKind: row.kind,
        count: row._count._all, oldestSince: row._min.requestedAt,
      });
    }
    for (const kind of Object.values(ProviderOperationKind)) {
      if (!present.has(kind)) cleared.add("provider-op:" + kind);
    }

    // One audit outcome per lookup is durable evidence. Only the latest
    // observed provider result for each distinct Colorado business day counts;
    // three retries on Tuesday are never counted as three failed days.
    const healthEvidence = await prisma.auditLog.findMany({
      where: {
        action: "tax.lookup_source_health",
        entityType: "TaxLookupSource", entityId: "colorado-gis",
        createdAt: { gte: new Date(now.getTime() - 7 * 24 * ONE_HOUR) },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
      select: { newValue: true },
    });
    const daily = new Map<string, "UNAVAILABLE" | "AVAILABLE">();
    for (const event of healthEvidence) {
      if (!event.newValue || typeof event.newValue !== "object" ||
          Array.isArray(event.newValue)) continue;
      const eventData = event.newValue as Record<string, unknown>;
      if (typeof eventData.businessDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(eventData.businessDate) ||
          (eventData.outcome !== "UNAVAILABLE" && eventData.outcome !== "AVAILABLE")) continue;
      if (!daily.has(eventData.businessDate)) {
        daily.set(eventData.businessDate, eventData.outcome);
      }
    }
    const dateKey = businessDateKey(now);
    const [year, month, day] = dateKey.split("-").map(Number);
    const dayZero = Date.UTC(year, month - 1, day);
    const recentDays = [0, 1, 2].map((i) =>
      new Date(dayZero - i * 24 * ONE_HOUR).toISOString().slice(0, 10));
    if (daily.get(dateKey) === "AVAILABLE") {
      cleared.add("tax-lookup");
    } else if (recentDays.every((dayKey) => daily.get(dayKey) === "UNAVAILABLE")) {
      issues.push({ kind: "TAX_LOOKUP_UNAVAILABLE", count: 3 });
    }

    const uncertainWhere = {
      state: "UNKNOWN" as const,
      requestedAt: { lte: new Date(now.getTime() - 48 * ONE_HOUR) },
    };
    const [unknownCount, oldestUnknown] = await Promise.all([
      prisma.messageDelivery.count({ where: uncertainWhere }),
      prisma.messageDelivery.findFirst({
        where: uncertainWhere, orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
        select: { requestedAt: true },
      }),
    ]);
    if (oldestUnknown && unknownCount > 0) {
      issues.push({ kind: "MESSAGE_DELIVERY_UNKNOWN",
        count: unknownCount, oldestSince: oldestUnknown.requestedAt });
    } else {
      cleared.add("message-unknown");
    }

    // Audit decisions carry only IDs, public jurisdiction codes and dates.
    // A subsequent applied decision is stronger evidence than an old rejected one.
    const decisions = await prisma.auditLog.findMany({
      where: { action: { in: [
        "OFFICIAL_RATE_AUTO_APPLY_REJECTED",
        "OFFICIAL_RATE_AUTO_APPLIED",
        "OFFICIAL_RATE_MANUAL_APPLIED",
      ] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: { action: true, newValue: true },
    });
    const seenDecisions = new Set<string>();
    for (const row of decisions.slice(0, input.limit)) {
      if (!row.newValue || typeof row.newValue !== "object" || Array.isArray(row.newValue)) continue;
      const fields = row.newValue as Record<string, unknown>;
      const jurisdictionId = fields.jurisdictionId;
      const jurisdictionCode = fields.jurisdictionCode;
      const effectiveFrom = fields.effectiveFrom;
      if (typeof jurisdictionId !== "string" || typeof effectiveFrom !== "string" ||
          !/^\d{4}-\d{2}-\d{2}/.test(effectiveFrom)) continue;
      const asOf = new Date(effectiveFrom);
      if (!Number.isFinite(asOf.getTime())) continue;
      const fingerprint = "tax-rate:" + jurisdictionId + ":" + asOf.toISOString().slice(0, 10);
      if (seenDecisions.has(fingerprint)) continue;
      seenDecisions.add(fingerprint);
      if (row.action !== "OFFICIAL_RATE_AUTO_APPLY_REJECTED") {
        cleared.add(fingerprint);
      } else if (typeof jurisdictionCode === "string" && typeof fields.observationId === "string") {
        issues.push({ kind: "TAX_RATE_GUARDRAIL", jurisdictionId, jurisdictionCode,
          asOf, observationId: fields.observationId });
      }
    }
  }

  // Cursor is the last fully inspected watch ID. Issue resolution is scoped
  // only to those rows actually read, never to an unobserved next page.
  const watches = await prisma.officialSourceWatch.findMany({
    where: { active: true, ...(input.cursor ? { id: { gt: input.cursor.slice(6) } } : {}) },
    orderBy: { id: "asc" },
    take: input.limit + 1,
    select: {
      id: true, url: true, lastHash: true, lastChangedAt: true,
      reviewedAt: true, consecutiveFailures: true,
    },
  });
  const page = watches.slice(0, input.limit);
  for (const watch of page) {
    if (watch.consecutiveFailures >= 3) {
      issues.push({ kind: "SOURCE_PAGE_UNREACHABLE", watchId: watch.id,
        officialUrl: watch.url, consecutiveFailures: watch.consecutiveFailures });
    } else if (watch.consecutiveFailures === 0) {
      cleared.add("source-page:" + watch.id);
    }
    if (watch.lastHash && watch.lastChangedAt &&
      (!watch.reviewedAt || watch.reviewedAt < watch.lastChangedAt)) {
      issues.push({ kind: "SOURCE_PAGE_CHANGED", watchId: watch.id,
        officialUrl: watch.url, contentHash: watch.lastHash });
    } else if (watch.lastHash) {
      cleared.add("source-page-changed:" + watch.id + ":" + watch.lastHash);
    }
  }
  const nextCursor = watches.length > input.limit && page.length > 0
    ? "watch:" + page[page.length - 1].id : null;
  return { issues, clearFingerprints: [...cleared], nextCursor };
}

/** Resolve only fingerprints whose entire source scope was observed. */
export async function sweepSystemIssues(
  now: Date,
  limit = 100,
): Promise<{ opened: number; resolved: number }> {
  let cursor: string | undefined, opened = 0, resolved = 0;
  // Fixed upper bound prevents a broken external source from monopolizing a cron.
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await collectSystemIssueInputs(now, { limit, cursor });
    // Count only what was actually written: a source row can disappear between reading and recording (for example an
    // official page deactivated meanwhile), and the run's report must not claim an issue it did not record.
    for (const issue of page.issues) {
      if (await recordSystemIssue(issue)) opened += 1;
    }
    for (const fingerprint of page.clearFingerprints) {
      if (await resolveSystemIssue(fingerprint, "SOURCE_SUCCEEDED")) resolved += 1;
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { opened, resolved };
}
