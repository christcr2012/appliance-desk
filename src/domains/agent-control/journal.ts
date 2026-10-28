import { createHash } from "node:crypto";
import { AgentOperationState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { createTaskInTx } from "@/domains/tasks";
import type { AgentContext } from "./authorization";
import type { McpScope } from "@/mcp/scopes";

const WINDOW_MS = 30 * 60 * 1000;

/** One request key is one attempt, never an authorization to start a new attempt. */
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, content]) => [key, stableValue(content)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("INVALID_ACTION_ARGUMENT");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new Error("INVALID_ACTION_ARGUMENT");
}

export function canonicalAgentArgs(args: Record<string, unknown>): { serialized: string; digest: string } {
  const normalized = stableValue(args);
  const serialized = JSON.stringify(normalized);
  if (serialized.length > 65_536) throw new Error("ACTION_ARGUMENT_TOO_LARGE");
  if (!serialized) throw new Error("INVALID_ACTION_ARGUMENT");
  return { serialized, digest: sha(serialized) };
}

const ACTION_PERMISSIONS = {
  RUN_DIAGNOSTIC_SWEEP: { scope: "ops:maintain", approval: "CONVERSATION" },
  RETRY_DATABASE_BACKUP: { scope: "ops:maintain", approval: "OWNER_IN_APP" },
  RETRY_MEDIA_COPY: { scope: "ops:maintain", approval: "OWNER_IN_APP" },
  PAUSE_AUTOMATION: { scope: "ops:maintain", approval: "OWNER_IN_APP" },
  RESUME_AUTOMATION: { scope: "ops:maintain", approval: "OWNER_IN_APP" },
  VERIFY_RECOVERY_ARTIFACT: { scope: "ops:maintain", approval: "CONVERSATION" },
  APPLY_DECISION_ANSWERS: { scope: "decisions:apply", approval: "CONVERSATION" },
} as const;

export type JournalAction = keyof typeof ACTION_PERMISSIONS;
export function journalActionPolicy(action: JournalAction) {
  return ACTION_PERMISSIONS[action];
}
export const OWNER_ONLY_JOURNAL_ACTIONS: ReadonlySet<JournalAction> = new Set([
  "RETRY_DATABASE_BACKUP", "RETRY_MEDIA_COPY", "PAUSE_AUTOMATION",
  "RESUME_AUTOMATION", "APPLY_DECISION_ANSWERS",
]);
export type JournalPreview = {
  summary: string;
  changes: { label: string; now: string; after: string }[];
  costNote?: string;
};

function previewSafe(value: JournalPreview): JournalPreview {
  if (value.summary.length > 250 || !value.summary.trim() || value.changes.length > 200 ||
      JSON.stringify(value).length > 65_536)
    throw new Error("INVALID_ACTION_PREVIEW");
  for (const c of value.changes) {
    if (c.label.length > 100 || c.now.length > 400 || c.after.length > 400)
      throw new Error("INVALID_ACTION_PREVIEW");
  }
  if ((value.costNote?.length ?? 0) > 300) throw new Error("INVALID_ACTION_PREVIEW");
  return value;
}

function mustScope(ctx: AgentContext, scopes: string[], scope: McpScope) {
  if (!ctx.scopes.includes(scope) || !scopes.includes(scope)) throw new Error("FORBIDDEN_SCOPE");
}

type PreviewArgs = {
  tool: string;
  action: JournalAction;
  targetRef?: string;
  args: Record<string, unknown>;
  requestKey: string;
  preview: JournalPreview;
  previewHash: string; // derived from fresh authoritative domain state by the registry
};

/** Validates and saves an action preview, never invokes a domain command. */
export async function createJournalPreview(ctx: AgentContext, input: PreviewArgs) {
  const policy = ACTION_PERMISSIONS[input.action];
  if (!policy) throw new Error("UNKNOWN_ACTION");
  if (!/^[a-z][a-z0-9_-]{2,79}$/.test(input.tool) ||
      !/^[a-zA-Z0-9_-]{12,128}$/.test(input.requestKey) ||
      (input.targetRef && (input.targetRef.length > 120 || /[^a-zA-Z0-9_:-]/.test(input.targetRef))) ||
      !/^[a-f0-9]{64}$/.test(input.previewHash)) throw new Error("INVALID_ACTION_INPUT");
  const safe = previewSafe(input.preview);
  const args = canonicalAgentArgs(input.args);
  const requestKeyDigest = sha(ctx.connectionId + ":" + input.requestKey);
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "McpConnection" WHERE "id" = ${ctx.connectionId} FOR UPDATE
    `;
    if (!locked) throw new Error("CONNECTION_REVOKED");
    const connection = await tx.mcpConnection.findUnique({
      where: { id: ctx.connectionId },
      select: { userId: true, scopes: true, revokedAt: true },
    });
    if (!connection || connection.userId !== ctx.userId || connection.revokedAt) throw new Error("CONNECTION_REVOKED");
    await assertActiveTeamActor(tx, ctx.userId, OWNER_ONLY_JOURNAL_ACTIONS.has(input.action) ? ["OWNER"] : ["OWNER", "ADMIN"]);
    mustScope(ctx, connection.scopes, policy.scope);
    const old = await tx.agentOperation.findUnique({
      where: { connectionId_tool_requestKeyDigest: { connectionId: ctx.connectionId,
        tool: input.tool, requestKeyDigest } },
    });
    if (old) {
      if (old.argsHash !== args.digest || old.action !== input.action || old.targetRef !== (input.targetRef ?? null))
        throw new Error("CONFLICT");
      return old;
    }
    const created = await tx.agentOperation.create({ data: {
      connectionId: ctx.connectionId, actorUserId: ctx.userId,
      tool: input.tool, action: input.action, targetRef: input.targetRef,
      requestKeyDigest, argsHash: args.digest, args: JSON.parse(args.serialized) as Prisma.InputJsonValue,
      previewHash: input.previewHash, preview: safe,
      state: policy.approval === "CONVERSATION" ?
        AgentOperationState.PREVIEWED : AgentOperationState.AWAITING_APPROVAL,
      expiresAt: new Date(Date.now() + WINDOW_MS),
    } });
    await tx.auditLog.create({ data: {
      userId: ctx.userId, action: "mcp.operation.previewed", entityType: "AgentOperation",
      entityId: created.id, newValue: { action: input.action, targetRef: input.targetRef ?? null },
    } });
    if (policy.approval === "OWNER_IN_APP") {
      await createTaskInTx(tx, { userId: ctx.userId, role: "OWNER" }, {
        note: "Approve or decline assistant action: " + safe.summary +
          ". Open System health > Assistant activity.",
        assigneeUserId: ctx.userId, priority: "HIGH", sourceKey: "assistant-action:" + created.id,
      });
    }
    return created;
  });
}

/** Owner-only app approval: consume the preview's current window, never a boolean reusable grant. */
export async function decideJournalApproval(actorId: string, operationId: string, approved: boolean) {
  return prisma.$transaction(async (tx) => {
    // The locator is not trusted: it is reread after the connection and operation rows are locked.
    const locator = await tx.agentOperation.findUnique({
      where: { id: operationId }, select: { connectionId: true },
    });
    if (!locator) throw new Error("OPERATION_NOT_FOUND");
    const [connectionLock] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "McpConnection" WHERE "id" = ${locator.connectionId} FOR UPDATE
    `;
    if (!connectionLock) throw new Error("CONNECTION_REVOKED");
    const [operationLock] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AgentOperation" WHERE "id" = ${operationId} FOR UPDATE
    `;
    if (!operationLock) throw new Error("OPERATION_NOT_FOUND");
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const [operation, connection] = await Promise.all([
      tx.agentOperation.findUniqueOrThrow({ where: { id: operationId } }),
      tx.mcpConnection.findUniqueOrThrow({ where: { id: locator.connectionId } }),
    ]);
    if (connection.revokedAt || operation.connectionId !== connection.id) throw new Error("CONNECTION_REVOKED");
    await assertActiveTeamActor(tx, connection.userId, ["OWNER", "ADMIN"]);
    const policy = ACTION_PERMISSIONS[operation.action as JournalAction];
    if (!policy || !connection.scopes.includes(policy.scope)) throw new Error("FORBIDDEN_SCOPE");
    if (operation.state !== AgentOperationState.AWAITING_APPROVAL) throw new Error("INVALID_APPROVAL_STATE");
    if (operation.expiresAt.getTime() <= Date.now()) {
      await tx.agentOperation.update({ where: { id: operationId },
        data: { state: AgentOperationState.EXPIRED } });
      // A transaction that throws would roll back expiry; return a safe terminal record instead.
      return { id: operation.id, state: AgentOperationState.EXPIRED };
    }
    const result = await tx.agentOperation.update({
      where: { id: operationId },
      data: {
        state: approved ? AgentOperationState.AUTHORIZED : AgentOperationState.DENIED,
        approvedByUserId: actorId, approvedAt: new Date(),
      },
      select: { id: true, state: true },
    });
    await tx.auditLog.create({ data: {
      userId: actorId, action: approved ? "mcp.operation.authorized" : "mcp.operation.denied",
      entityType: "AgentOperation", entityId: operationId,
      newValue: { action: operation.action, targetRef: operation.targetRef },
    } });
    await tx.staffTask.updateMany({
      where: { sourceKey: "assistant-action:" + operationId, completedAt: null },
      data: { completedAt: new Date(), version: { increment: 1 } },
    });
    return result;
  });
}
