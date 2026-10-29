import { SystemIssueStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getAutomationHealth, AUTOMATION_RULES } from "@/domains/automation/health";
import { listSystemIssues } from "@/domains/system-issues/queries";
import { failureExplanation } from "@/domains/automation/failures";
import { getBackupDashboard } from "@/domains/backup/dashboard";
import { listDecisions, getDecision, type DecisionCard } from "@/domains/decisions";
import type { AgentContext } from "@/domains/agent-control/authorization";

/** These functions ONLY return carefully selected machine-owned fields. Never return raw models. */
const at = (value: Date | null | undefined) => value?.toISOString() ?? null;

export async function checkMcpActor(ctx: AgentContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ctx.userId, ["OWNER", "ADMIN"]);
  });
}

export async function healthOverview(ctx: AgentContext, input: { cursor?: string; limit?: number } = {}): Promise<Record<string, unknown>> {
  await checkMcpActor(ctx);
  const rows = await getAutomationHealth();
  const states: Record<string, number> = {};
  for (const row of rows) states[row.state] = (states[row.state] ?? 0) + 1;
  const start = input.cursor ? rows.findIndex((row) => row.ruleKey === input.cursor) + 1 : 0;
  if (input.cursor && start === 0) throw new Error("INVALID_CURSOR");
  const selected = rows.slice(start, start + (input.limit ?? 10));
  return {
    states,
    jobs: selected.map((row) => ({
      key: row.ruleKey, title: row.label, state: row.state,
      explanation: row.explanation, nextStep: row.state === "healthy" ? "No action needed" : "Review System health in the app",
      lastGoodUtc: at(row.lastSuccessAt), nextDueUtc: at(row.nextDueAt),
      nextDueDenver: row.nextDueAt ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", dateStyle: "short", timeStyle: "short" }).format(row.nextDueAt) : null,
      failureCode: row.lastFailure?.code ?? null,
      missingSettings: row.missingEnv,
    })),
    nextCursor: start + selected.length < rows.length ? selected.at(-1)?.ruleKey ?? null : null,
  };
}

function safeStage(value: string | null | undefined): string | null {
  return value && /^[a-z][a-z0-9-]{0,29}$/.test(value) ? value : null;
}
function safeReference(value: string | null | undefined): string | null {
  return value && /^ref-[a-f0-9]{10}$/.test(value) ? value : null;
}

function safeIssue(row: {
  id: string; kind: string; severity: string; status: string; occurrences: number;
  firstSeenAt: Date; lastSeenAt: Date; failureCode?: string | null;
  failureStage?: string | null; correlationId?: string | null;
  failure?: { code: string | null; stage: string | null; reference: string | null; explain: string; next: string } | null;
}) {
  const failure = row.failure ?? (row.failureCode ? {
    ...failureExplanation(row.failureCode),
    stage: row.failureStage ?? null, reference: row.correlationId ?? null,
  } : null);
  return {
    id: row.id, kind: row.kind, severity: row.severity, status: row.status,
    count: row.occurrences, firstSeenUtc: at(row.firstSeenAt), lastSeenUtc: at(row.lastSeenAt),
    failure: failure ? { code: failureExplanation(failure.code).code, stage: safeStage(failure.stage), reference: safeReference(failure.reference),
      explanation: failure.explain, nextStep: failure.next } : null,
  };
}

export async function issuesList(ctx: AgentContext, input: { cursor?: string; limit: number }) {
  const page = await listSystemIssues(ctx.userId, { status: SystemIssueStatus.OPEN, cursor: input.cursor, limit: input.limit });
  return { issues: page.rows.map((row) => safeIssue(row)), nextCursor: page.nextCursor };
}

export async function issueGet(ctx: AgentContext, id: string) {
  await checkMcpActor(ctx);
  const issue = await prisma.systemIssue.findUnique({
    where: { id }, select: { id: true, kind: true, severity: true, status: true,
      occurrences: true, firstSeenAt: true, lastSeenAt: true,
      failureCode: true, failureStage: true, correlationId: true },
  });
  if (!issue) return { found: false, issue: null, recentRuns: [] };
  const runs = issue.correlationId ? await prisma.automationRun.findMany({
    where: { correlationId: issue.correlationId }, take: 10,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { ruleKey: true, state: true, startedAt: true, finishedAt: true,
      failureCode: true, failureStage: true, correlationId: true },
  }) : [];
  return { found: true, issue: safeIssue(issue), recentRuns: runs.map((run) => ({
    job: run.ruleKey, state: run.state, startedUtc: at(run.startedAt), finishedUtc: at(run.finishedAt),
    code: failureExplanation(run.failureCode).code, stage: safeStage(run.failureStage), reference: safeReference(run.correlationId),
  })) };
}

export async function automationRuns(ctx: AgentContext, job: string, limit: number) {
  await checkMcpActor(ctx);
  if (!AUTOMATION_RULES.some((rule) => rule.ruleKey === job)) throw new Error("UNKNOWN_JOB");
  const runs = await prisma.automationRun.findMany({
    where: { ruleKey: job }, take: limit,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { id: true, state: true, startedAt: true, finishedAt: true, failureCode: true,
      failureStage: true, correlationId: true },
  });
  return { job, runs: runs.map((run) => ({ id: run.id, state: run.state,
    startedUtc: at(run.startedAt), finishedUtc: at(run.finishedAt), code: failureExplanation(run.failureCode).code,
    stage: safeStage(run.failureStage), reference: safeReference(run.correlationId) })) };
}

export async function configurationReadiness(ctx: AgentContext) {
  await checkMcpActor(ctx);
  const [rows, dashboard] = await Promise.all([getAutomationHealth(), getBackupDashboard()]);
  return { integrations: rows.map((row) => ({
    job: row.ruleKey, state: row.state, missingSettingNames: row.missingEnv,
  })), privateStore: dashboard.privatePhotos };
}

/** The verified artifact ledger is the source of truth, not scheduled-job success. */
export async function backupStatus(ctx: AgentContext) {
  await checkMcpActor(ctx);
  const [dashboard, manifest] = await Promise.all([
    getBackupDashboard(),
    prisma.backupArtifact.findFirst({
      where: { kind: "MEDIA_MANIFEST", state: "VERIFIED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { verifiedAt: true, photoCounts: true },
    }),
  ]);
  const counts = manifest?.photoCounts;
  const numbers = counts && typeof counts === "object" && !Array.isArray(counts) ?
    counts as Record<string, unknown> : {};
  const count = (key: string) => typeof numbers[key] === "number" &&
    Number.isSafeInteger(numbers[key]) && (numbers[key] as number) >= 0 ?
    numbers[key] as number : null;
  const latest = dashboard.latestVerifiedAt;
  const pastRetention = !latest || Date.now() - latest.getTime() >
    dashboard.retentionDays * 24 * 60 * 60 * 1000;
  return {
    latestVerifiedBackupUtc: at(latest),
    latestCompletePairUtc: at(dashboard.lastCompleteAt),
    lastVerifiedMediaUtc: at(manifest?.verifiedAt),
    photoCopies: { copied: count("copied"), unchanged: count("unchanged"),
      missing: count("missing"), tombstoned: count("tombstoned") },
    retentionDays: dashboard.retentionDays,
    retentionAttention: pastRetention ? "attention" : "current",
    storage: dashboard.destination === "not set up" ? "not_configured" : "configured",
  };
}

/** Answers are stored privately; only simple booleans and bounded numeric words may leave the app. */
export function safeDecisionWords(input: string): string {
  if (/^(?:yes|no|true|false|on|off|not set|unknown|none|not decided)$/i.test(input.trim())) return input.trim();
  if (/^\$?\d{1,12}(?:[,.]\d{1,4})?(?:\s?(?:%|days|years|hours))?$/.test(input.trim())) return input.trim();
  return "Recorded privately — open Decisions in the app";
}
function safeDecision(card: DecisionCard) {
  return { id: card.id, area: card.area, title: card.title, question: card.question,
    state: card.state, current: safeDecisionWords(card.current.words),
    recommended: card.recommended === null ? "No proposed value" : "Proposed value in app",
    lastRecordedUtc: at(card.last?.createdAt),
  };
}
export async function decisionsList(ctx: AgentContext, input: { cursor?: string; limit: number }) {
  const all = await listDecisions(ctx.userId);
  const start = input.cursor ? all.findIndex((card) => card.id === input.cursor) + 1 : 0;
  if (input.cursor && start === 0) throw new Error("INVALID_CURSOR");
  const page = all.slice(start, start + input.limit);
  const remaining = Math.max(0, all.length - start - page.length);
  return {
    decisions: page.map(safeDecision),
    remaining,
    nextCursor: remaining > 0 ? page.at(-1)?.id ?? null : null,
  };
}
export async function decisionGet(ctx: AgentContext, id: string) {
  const card = await getDecision(ctx.userId, id);
  return { decision: safeDecision(card), history: card.history.slice(0, 20).map((row) => ({
    id: row.id, recordedUtc: at(row.createdAt),
    // Prior answers can be freeform private information; display their existence, not content.
    state: "An answer was recorded privately",
  })) };
}
