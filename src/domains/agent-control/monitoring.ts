import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateKey, businessDayBounds } from "@/lib/business-date";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getAutomationHealth } from "@/domains/automation/health";
import { sendOwnerAlert } from "@/domains/messaging/owner-alerts";
import { previewAgentOperation, executeAgentOperation } from "./operations";
import type { AgentContext } from "./authorization";
import type { JournalAction } from "./journal";

export const MONITOR_KEYS = [
  "jobs-late-or-failing", "backup-not-verified-today", "photo-copy-not-paired",
  "open-high-issues", "assistant-action-uncertain", "feedback-waiting-3-days",
  "heartbeat",
] as const;
export type MonitorKey = (typeof MONITOR_KEYS)[number];
export const MONITOR_WORDS: Record<MonitorKey, string> = {
  "jobs-late-or-failing": "Scheduled work late or failing",
  "backup-not-verified-today": "No verified database backup today",
  "photo-copy-not-paired": "Latest backup lacks a verified photo copy",
  "open-high-issues": "High-priority system problems",
  "assistant-action-uncertain": "Assistant actions with uncertain results",
  "feedback-waiting-3-days": "App feedback waiting over three days",
  "heartbeat": "Health check itself has not run",
};
export const RECOMMENDED_MONITOR = {
  enabled: false, failuresBeforeAlert: 2, cooldownHours: 24,
  notifyEmail: false, autoAction: null, autoActionConnectionId: null,
} as const;
/** Only zero-argument MCP-5 operations can be delegated by the initial monitoring rules. */
export const MONITOR_ACTIONS = [
  { value: "RUN_DIAGNOSTIC_SWEEP", label: "Check system problems again" },
  { value: "RETRY_DATABASE_BACKUP", label: "Retry an eligible failed database backup" },
] as const;
export type MonitorAction = (typeof MONITOR_ACTIONS)[number]["value"];
const allowedAction = (value: string): value is MonitorAction =>
  MONITOR_ACTIONS.some(option => option.value === value);

export async function listMonitorConnections(ownerId: string) {
  return prisma.mcpConnection.findMany({
    where: { userId: ownerId, revokedAt: null, scopes: { has: "ops:maintain" } },
    select: { id: true, label: true }, orderBy: { label: "asc" },
  });
}
export const RULE_FAILURE_MIN = 1;
export const RULE_FAILURE_MAX = 10;
export const RULE_COOLDOWN_MAX = 168;
export function validateMonitorSettings(input: {
  key: string; enabled: boolean; failuresBeforeAlert: number; cooldownHours: number;
  notifyEmail: boolean; autoAction?: string | null; autoActionConnectionId?: string | null;
}) {
  if (!MONITOR_KEYS.includes(input.key as MonitorKey) || input.key === "heartbeat") {
    throw new Error("Choose an available check; heartbeat is reported automatically.");
  }
  if (!Number.isInteger(input.failuresBeforeAlert) || input.failuresBeforeAlert < RULE_FAILURE_MIN ||
      input.failuresBeforeAlert > RULE_FAILURE_MAX) {
    throw new Error("Choose between 1 and 10 failed checks.");
  }
  if (!Number.isInteger(input.cooldownHours) || input.cooldownHours < 1 ||
      input.cooldownHours > RULE_COOLDOWN_MAX) {
    throw new Error("Choose between 1 and 168 hours before repeating an alert.");
  }
  if (Boolean(input.autoAction) !== Boolean(input.autoActionConnectionId)) {
    throw new Error("Choose both an assistant action and its active connection, or neither.");
  }
  if (input.autoAction && !allowedAction(input.autoAction)) {
    throw new Error("This assistant action is not permitted for monitoring.");
  }
}
export async function listMonitorRules() {
  const rows = await prisma.monitorRule.findMany();
  const byKey = new Map(rows.map(row => [row.key, row]));
  return MONITOR_KEYS.map(key => ({
    key, label: MONITOR_WORDS[key], ...RECOMMENDED_MONITOR,
    ...byKey.get(key), configurable: key !== "heartbeat",
  }));
}
export async function saveMonitorRule(actorId: string, input: {
  key: string; enabled: boolean; failuresBeforeAlert: number; cooldownHours: number;
  notifyEmail: boolean; expectedVersion: number | null; restore?: boolean;
  autoAction?: string | null; autoActionConnectionId?: string | null;
}) {
  const next = input.restore ? { ...RECOMMENDED_MONITOR } : {
    enabled: input.enabled, failuresBeforeAlert: input.failuresBeforeAlert,
    cooldownHours: input.cooldownHours, notifyEmail: input.notifyEmail,
    autoAction: input.autoAction || null,
    autoActionConnectionId: input.autoActionConnectionId || null,
  };
  validateMonitorSettings({ key: input.key, ...next });
  await prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    if (next.autoActionConnectionId) {
      const selected = await tx.mcpConnection.findUnique({
        where: { id: next.autoActionConnectionId },
        select: { userId: true, scopes: true, revokedAt: true },
      });
      if (!selected || selected.userId !== actorId || selected.revokedAt ||
          !selected.scopes.includes("ops:maintain"))
        throw new Error("This assistant connection is no longer authorized for maintenance.");
    }
    await tx.$queryRaw`SELECT "id" FROM "MonitorRule" WHERE "key" = ${input.key} FOR UPDATE`;
    const current = await tx.monitorRule.findUnique({ where: { key: input.key } });
    if ((current?.version ?? null) !== input.expectedVersion) throw new Error("These monitoring settings changed. Reload and try again.");
    if (!current) {
      await tx.monitorRule.create({ data: { key: input.key, ...next } });
    } else {
      await tx.monitorRule.update({
        where: { id: current.id }, data: { ...next, version: { increment: 1 } },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export type MonitorSignal = { failed: boolean; detail: string };
async function readSignal(key: MonitorKey, now: Date): Promise<MonitorSignal> {
  const { start, end } = businessDayBounds(now);
  switch (key) {
    case "jobs-late-or-failing": {
      const rows = await getAutomationHealth(now);
      const failed = rows.some(row => row.ruleKey !== "system-issues-sweep" &&
        ["late", "failing", "unknown"].includes(row.state));
      return { failed, detail: "One or more scheduled jobs needs attention." };
    }
    case "backup-not-verified-today": {
      const count = await prisma.backupArtifact.count({
        where: { kind: "DATABASE", state: "VERIFIED", verifiedAt: { gte: start, lt: end } },
      });
      return { failed: count === 0, detail: "No verified database backup was recorded for this Colorado day." };
    }
    case "photo-copy-not-paired": {
      const latest = await prisma.backupArtifact.findFirst({
        where: { kind: "DATABASE", state: "VERIFIED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { mediaManifests: { where: { state: "VERIFIED", kind: "MEDIA_MANIFEST" }, take: 1, select: { id: true } } },
      });
      return { failed: Boolean(latest && !latest.mediaManifests.length), detail: "The latest verified database backup has no paired verified photo manifest." };
    }
    case "open-high-issues": {
      const count = await prisma.systemIssue.count({ where: { status: "OPEN", severity: "HIGH", kind: { not: "MONITOR_ALERT" } } });
      return { failed: count > 0, detail: "At least one high-priority system issue is still open." };
    }
    case "assistant-action-uncertain": {
      const count = await prisma.agentOperation.count({ where: { state: "UNKNOWN" } });
      return { failed: count > 0, detail: "At least one assistant action has an unknown outcome." };
    }
    case "feedback-waiting-3-days": {
      const until = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
      const count = await prisma.feedbackReport.count({
        where: { awaitingTeam: true, updatedAt: { lte: until },
          state: { notIn: ["RESOLVED", "DUPLICATE", "DECLINED", "CLOSED"] } },
      });
      return { failed: count > 0, detail: "An app problem report has waited more than three days for a team response." };
    }
    case "heartbeat":
      return { failed: false, detail: "The daily health sweep is running." };
  }
}
/**
 * Claim each Colorado-day slot while holding the stored rule row. A second worker
 * waits for this transaction, then sees the slot and does nothing. Repeated
 * failures share ONE open issue fingerprint; a recovery closes that issue.
 */
/**
 * Preview, link and execute through MCP-5. This never calls a domain writer directly.
 * The linked operation ID and the tool's rule revision form an immutable receipt.
 */
async function executeMonitoringAction(
  key: MonitorKey, slot: string, version: number, action: MonitorAction, connectionId: string,
  beforeDispatch?: () => Promise<void>,
) {
  const connection = await prisma.mcpConnection.findUnique({
    where: { id: connectionId },
    include: { user: { select: { id: true, role: true, archivedAt: true, name: true } } },
  });
  if (!connection || connection.revokedAt || connection.user.archivedAt ||
      connection.user.role !== "OWNER" || !connection.scopes.includes("ops:maintain"))
    throw new Error("MONITORING_GRANT_REVOKED");
  const ctx: AgentContext = {
    userId: connection.userId, name: connection.user.name ?? "Owner",
    role: "OWNER", connectionId: connection.id, connectionLabel: connection.label,
    scopes: ["ops:maintain"],
  };
  const requestKey = "monitor_" + createHash("sha256").update(key + ":" + slot).digest("hex").slice(0, 28);
  const preview = await previewAgentOperation(ctx, {
    action, args: {}, requestKey, monitor: { ruleKey: key, ruleVersion: version },
  });
  const linked = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "MonitorRule" WHERE "key" = ${key} FOR UPDATE`;
    const rule = await tx.monitorRule.findUnique({ where: { key } });
    if (!rule?.enabled || rule.version !== version ||
        rule.autoAction !== action || rule.autoActionConnectionId !== connectionId)
      return false;
    const updated = await tx.monitorRun.updateMany({
      where: { ruleKey: key, slot, state: "ALERT", operationId: null },
      data: { operationId: preview.previewId },
    });
    return updated.count === 1;
  });
  if (linked) {
    try {
      // The hook is used by disposable-database race tests; scheduled runs never supply one.
      await beforeDispatch?.();
      await executeAgentOperation(ctx, { previewId: preview.previewId, requestKey });
    } catch (error) {
      // A revocation before claiming is a definite refusal, not an uncertain effect.
      // Never touch an operation that may already have begun running.
      await prisma.agentOperation.updateMany({
        where: { id: preview.previewId, state: { in: ["PREVIEWED", "AWAITING_APPROVAL"] } },
        data: { state: "DENIED", failureCode: "MONITORING_GRANT_REVOKED" },
      });
      throw error;
    }
  }
}

export async function runMonitors(now = new Date(), input?: {
  evaluate?: (key: MonitorKey, now: Date) => Promise<MonitorSignal>;
  notify?: (key: MonitorKey, slot: string) => Promise<void>;
  beforeDispatch?: () => Promise<void>; // test-only race hook
}) {
  const slot = businessDateKey(now);
  const rules = await prisma.monitorRule.findMany({ where: { enabled: true }, orderBy: { key: "asc" } });
  let checked = 0, alerted = 0, recovered = 0;
  for (const rule of rules) {
    if (!MONITOR_KEYS.includes(rule.key as MonitorKey)) continue;
    const key = rule.key as MonitorKey;
    const signal = await (input?.evaluate ?? readSignal)(key, now);
    const receipt = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "MonitorRule" WHERE "id" = ${rule.id} FOR UPDATE`;
      const liveRule = await tx.monitorRule.findUnique({ where: { id: rule.id } });
      if (!liveRule?.enabled || liveRule.version !== rule.version) return null;
      const existing = await tx.monitorRun.findUnique({ where: { ruleKey_slot: { ruleKey: key, slot } } });
      if (existing) return null;
      const prior = await tx.monitorRun.findFirst({
        where: { ruleKey: key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const failures = signal.failed ? (prior?.consecutiveFailures ?? 0) + 1 : 0;
      const issueKey = "monitor:" + key;
      const issue = await tx.systemIssue.findUnique({ where: { fingerprint: issueKey } });
      const wasOpen = Boolean(issue && issue.status !== "RESOLVED");
      const lastNotification = await tx.monitorRun.findFirst({
        where: { ruleKey: key, notifiedAt: { not: null } },
        orderBy: [{ notifiedAt: "desc" }, { id: "desc" }], select: { notifiedAt: true },
      });
      const pastCooldown = !lastNotification?.notifiedAt ||
        now.getTime() - lastNotification.notifiedAt.getTime() >= liveRule.cooldownHours * 60 * 60_000;
      const shouldAlert = signal.failed && failures >= liveRule.failuresBeforeAlert && (!wasOpen || pastCooldown);
      const shouldRecover = !signal.failed && wasOpen;
      const state = shouldRecover ? "RECOVERED" : shouldAlert ? "ALERT" : signal.failed ? "SKIPPED" : "OK";
      await tx.monitorRun.create({ data: {
        ruleKey: key, slot, state, consecutiveFailures: failures, createdAt: now,
        notifiedAt: shouldAlert ? now : null,
      } });
      if (shouldAlert) {
        await tx.systemIssue.upsert({
          where: { fingerprint: issueKey },
          create: { fingerprint: issueKey, kind: "MONITOR_ALERT", severity: "HIGH",
            summary: MONITOR_WORDS[key], detail: signal.detail, lastSeenAt: now },
          update: { status: "OPEN", resolvedAt: null, resolvedReason: null,
            severity: "HIGH", summary: MONITOR_WORDS[key], detail: signal.detail, lastSeenAt: now,
            occurrences: { increment: 1 }, version: { increment: 1 } },
        });
      }
      if (shouldRecover && issue) {
        await tx.systemIssue.update({ where: { id: issue.id }, data: {
          status: "RESOLVED", resolvedAt: now, resolvedReason: "SOURCE_SUCCEEDED",
          version: { increment: 1 },
        } });
      }
      return {
        state, notify: shouldAlert && liveRule.notifyEmail,
        action: shouldAlert && liveRule.autoAction && allowedAction(liveRule.autoAction)
          ? liveRule.autoAction : null,
        connectionId: shouldAlert ? liveRule.autoActionConnectionId : null,
        ruleVersion: liveRule.version,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (!receipt) continue;
    checked++;
    if (receipt.state === "RECOVERED") recovered++;
    if (receipt.state === "ALERT") alerted++;
    if (receipt.action && receipt.connectionId) {
      try {
        await executeMonitoringAction(key, slot, receipt.ruleVersion, receipt.action, receipt.connectionId, input?.beforeDispatch);
      } catch {
        // The ALERT is still durable. Never retry a possibly started operation automatically.
        // An operation that reached the journal remains visible in Assistant activity.
      }
    }
    if (receipt.notify) {
      try {
        if (input?.notify) await input.notify(key, slot);
        else await sendOwnerAlert({ key: "monitor:" + key + ":" + slot,
          subject: MONITOR_WORDS[key], text: signal.detail, href: "/desk/automations" });
      } catch {
        await prisma.monitorRun.update({
          where: { ruleKey_slot: { ruleKey: key, slot } },
          data: { emailErrorCode: "OWNER_EMAIL_NOT_SENT" },
        });
      }
    }
  }
  return { checked, alerted, recovered };
}
