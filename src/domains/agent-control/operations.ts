import { createHash, randomBytes } from "node:crypto";
import { Prisma, type AgentOperationState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordSystemIssue, resolveSystemIssue } from "@/domains/system-issues";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { AgentContext } from "./authorization";
import {
  canonicalAgentArgs, createJournalPreview, journalActionPolicy, OWNER_ONLY_JOURNAL_ACTIONS,
  type JournalAction,
} from "./journal";
import { prepareAgentAction, dispatchAgentAction, verifyAgentAction, parseAgentAction } from "./actions";

const LEASE_MS = 300_000;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const terminal: AgentOperationState[] = ["SUCCEEDED", "FAILED", "UNKNOWN", "DENIED", "CANCELLED", "EXPIRED"];
type SafeRow = { id: string; state: AgentOperationState; action: string; targetRef: string | null;
  failureCode: string | null; safeResult: Prisma.JsonValue | null; verification: Prisma.JsonValue | null;
  expiresAt: Date };
const view = (op: SafeRow) => ({ id: op.id, state: op.state, action: op.action, targetRef: op.targetRef,
  failureCode: op.failureCode, safeResult: op.safeResult, verification: op.verification,
  expiresAt: op.expiresAt.toISOString() });

function policyFor(action: string) {
  const policy = journalActionPolicy(action as JournalAction);
  if (!policy) throw new Error("UNKNOWN_ACTION");
  return policy;
}

/** Only fixed, parameterized row-lock queries. Connection is always locked before operation. */
async function lockConnection(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "McpConnection" WHERE "id" = ${id} FOR UPDATE
  `;
  if (!rows[0]) throw new Error("CONNECTION_REVOKED");
}
async function lockOperation(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "AgentOperation" WHERE "id" = ${id} FOR UPDATE
  `;
  if (!rows[0]) throw new Error("OPERATION_NOT_FOUND");
}

export async function previewAgentOperation(ctx: AgentContext, input: {
  action: JournalAction; args: Record<string, unknown>; requestKey: string;
}) {
  const policy = policyFor(input.action);
  if (!ctx.scopes.includes(policy.scope)) throw new Error("FORBIDDEN_SCOPE");
  if (OWNER_ONLY_JOURNAL_ACTIONS.has(input.action) && ctx.role !== "OWNER") throw new Error("OWNER_REQUIRED");
  const prepared = await prepareAgentAction(ctx, input.action, input.args);
  const op = await createJournalPreview(ctx, {
    tool: "appliance_action_preview", action: input.action, requestKey: input.requestKey,
    args: prepared.args, targetRef: prepared.targetRef,
    preview: prepared.preview, previewHash: prepared.previewHash,
  });
  return { previewId: op.id, state: op.state, summary: prepared.preview.summary,
    changes: prepared.preview.changes, costNote: prepared.preview.costNote ?? null,
    approval: policy.approval, expiresAt: op.expiresAt.toISOString() };
}

export async function getAgentOperation(ctx: AgentContext, operationId: string) {
  const row = await prisma.agentOperation.findFirst({ where: {
    id: operationId, connectionId: ctx.connectionId, actorUserId: ctx.userId,
  }, include: { connection: { select: { scopes: true, revokedAt: true, userId: true } } } });
  if (!row || row.connection.revokedAt || row.connection.userId !== ctx.userId)
    throw new Error("OPERATION_NOT_FOUND");
  const policy = policyFor(row.action);
  if (!ctx.scopes.includes(policy.scope) || !row.connection.scopes.includes(policy.scope))
    throw new Error("FORBIDDEN_SCOPE");
  await prisma.$transaction(async (tx) => { await assertActiveTeamActor(tx, ctx.userId, ["OWNER", "ADMIN"]); });
  return view(row);
}

/** Authorize and claim once, commit the intent, then dispatch outside the short database transaction. */
export async function executeAgentOperation(ctx: AgentContext, input: {
  previewId: string; requestKey: string;
}) {
  if (!/^[a-zA-Z0-9_-]{12,128}$/.test(input.requestKey)) throw new Error("INVALID_ACTION_INPUT");
  const locator = await prisma.agentOperation.findFirst({
    where: { id: input.previewId, connectionId: ctx.connectionId },
    select: { action: true, args: true, argsHash: true },
  });
  if (!locator) throw new Error("OPERATION_NOT_FOUND");
  const action = locator.action as JournalAction;
  policyFor(action);
  const args = parseAgentAction(action, locator.args);
  if (canonicalAgentArgs(args).digest !== locator.argsHash) throw new Error("OPERATION_ARGUMENT_TAMPERED");
  const fresh = await prepareAgentAction(ctx, action, args).catch(() => null);
  const requestDigest = sha(ctx.connectionId + ":" + input.requestKey);

  const claim = await prisma.$transaction(async (tx) => {
    await lockConnection(tx, ctx.connectionId);
    await lockOperation(tx, input.previewId);
    const [connection, op] = await Promise.all([
      tx.mcpConnection.findUniqueOrThrow({ where: { id: ctx.connectionId } }),
      tx.agentOperation.findUniqueOrThrow({ where: { id: input.previewId } }),
    ]);
    if (connection.revokedAt || connection.userId !== ctx.userId || op.actorUserId !== ctx.userId)
      throw new Error("CONNECTION_REVOKED");
    const policy = policyFor(op.action);
    await assertActiveTeamActor(tx, ctx.userId, OWNER_ONLY_JOURNAL_ACTIONS.has(action) ? ["OWNER"] : ["OWNER", "ADMIN"]);
    if (!ctx.scopes.includes(policy.scope) || !connection.scopes.includes(policy.scope))
      throw new Error("FORBIDDEN_SCOPE");
    if (op.requestKeyDigest !== requestDigest) throw new Error("REQUEST_KEY_MISMATCH");
    if (op.argsHash !== canonicalAgentArgs(parseAgentAction(action, op.args)).digest)
      throw new Error("OPERATION_ARGUMENT_TAMPERED");
    if (terminal.includes(op.state) || op.state === "RUNNING") return { op, claimToken: "" };
    if (!["PREVIEWED", "AUTHORIZED"].includes(op.state)) throw new Error("OWNER_APPROVAL_REQUIRED");
    const expired = op.expiresAt.getTime() <= Date.now();
    const changed = !fresh || fresh.previewHash !== op.previewHash || fresh.targetRef !== op.targetRef;
    if (expired || changed) {
      const ended = await tx.agentOperation.update({ where: { id: op.id },
        data: { state: "EXPIRED", failureCode: expired ? "PREVIEW_EXPIRED" : "PREVIEW_CHANGED" } });
      await tx.auditLog.create({ data: { userId: ctx.userId, action: "mcp.operation.expired",
        entityType: "AgentOperation", entityId: op.id,
        newValue: { action, targetRef: op.targetRef, reason: expired ? "expired" : "changed" } } });
      return { op: ended, claimToken: "" };
    }
    if ((policy.approval === "OWNER_IN_APP" && (op.state !== "AUTHORIZED" || !op.approvedByUserId)) ||
      (policy.approval === "CONVERSATION" && op.state !== "PREVIEWED"))
      throw new Error("OWNER_APPROVAL_REQUIRED");
    if (JSON.stringify(fresh.verifyIntent).length > 8192) throw new Error("VERIFY_INTENT_TOO_LARGE");

    const claimToken = randomBytes(16).toString("hex");
    const now = new Date();
    const running = await tx.agentOperation.update({ where: { id: op.id },
      data: { state: "RUNNING", attempt: { increment: 1 }, leaseToken: claimToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS), startedAt: now,
        verifyIntent: fresh.verifyIntent as Prisma.InputJsonValue, failureCode: null } });
    await tx.auditLog.create({ data: { userId: ctx.userId, action: "mcp.operation.running",
      entityType: "AgentOperation", entityId: op.id, newValue: { action, targetRef: op.targetRef } } });
    return { op: running, claimToken };
  }, { timeout: 15000 });

  if (!claim.claimToken) return view(claim.op);
  const op = claim.op;
  let safeResult: Record<string, unknown> | null = null;
  let verification: Record<string, unknown> | null = null;
  let state: AgentOperationState = "UNKNOWN";
  let failureCode: string | null = null;
  let dispatchStarted = false;
  try {
    // A revoked connection or downgraded user between the durable claim and
    // actual dispatch cannot start a command. This closes the ordinary delay
    // between those two stages; domain commands retain their own actor gates.
    await prisma.$transaction(async (tx) => {
      await lockConnection(tx, ctx.connectionId);
      const current = await tx.mcpConnection.findUniqueOrThrow({
        where: { id: ctx.connectionId },
        select: { userId: true, scopes: true, revokedAt: true },
      });
      if (current.revokedAt || current.userId !== ctx.userId) throw new Error("CONNECTION_REVOKED");
      const policy = policyFor(action);
      if (!current.scopes.includes(policy.scope) || !ctx.scopes.includes(policy.scope))
        throw new Error("FORBIDDEN_SCOPE");
      await assertActiveTeamActor(tx, ctx.userId,
        OWNER_ONLY_JOURNAL_ACTIONS.has(action) ? ["OWNER"] : ["OWNER", "ADMIN"]);
      const claimRow = await tx.agentOperation.findUniqueOrThrow({ where: { id: op.id },
        select: { state: true, leaseToken: true, expiresAt: true } });
      if (claimRow.state !== "RUNNING" || claimRow.leaseToken !== claim.claimToken ||
          claimRow.expiresAt.getTime() <= Date.now()) throw new Error("EXECUTION_LEASE_INVALID");
    }, { timeout: 12000 });
    dispatchStarted = true;
    safeResult = await dispatchAgentAction(ctx, action, args, op.id);
    const checked = await verifyAgentAction(ctx, action, op.verifyIntent, op.id, op.startedAt!, safeResult);
    verification = { ...checked.observed, checkedAt: new Date().toISOString() };
    if (checked.ok) state = "SUCCEEDED";
    else failureCode = "VERIFY_UNCERTAIN";
  } catch (error) {
    // A lost response is never proof of no effect. A DEC-1 transaction rejects atomically.
    const noEffect = !dispatchStarted || (error instanceof Error && (
      (action === "APPLY_DECISION_ANSWERS" &&
        /preview|answer|decision|form|changed|expired/i.test(error.message)) ||
      (["PAUSE_AUTOMATION", "RESUME_AUTOMATION"].includes(action) &&
        error.message === "PREVIEW_CHANGED")
    ));
    state = noEffect ? "FAILED" : "UNKNOWN";
    failureCode = !dispatchStarted ? "DISPATCH_AUTH_REVOKED" :
      noEffect ? "DOMAIN_REFUSED" : "EFFECT_UNCERTAIN";
  }

  const finished = await prisma.$transaction(async (tx) => {
    await lockOperation(tx, op.id);
    const latest = await tx.agentOperation.findUniqueOrThrow({ where: { id: op.id } });
    if (latest.state !== "RUNNING" || latest.leaseToken !== claim.claimToken) return latest;
    const updated = await tx.agentOperation.update({ where: { id: op.id },
      data: { state, failureCode, leaseToken: null, leaseExpiresAt: null, finishedAt: new Date(),
        safeResult: safeResult ? safeResult as Prisma.InputJsonValue : Prisma.DbNull,
        verification: verification ? verification as Prisma.InputJsonValue : Prisma.DbNull } });
    await tx.auditLog.create({ data: { userId: ctx.userId,
      action: "mcp.operation." + state.toLowerCase(), entityType: "AgentOperation", entityId: op.id,
      newValue: { action, targetRef: op.targetRef, failureCode } } });
    return updated;
  });
  return view(finished);
}

/** Nightly readback: fence old workers; reconcile UNKNOWN; never run the domain command again. */
export async function reconcileAgentOperations(now = new Date(), limit = 40) {
  const previews = await prisma.agentOperation.findMany({ where: {
    state: { in: ["PREVIEWED", "AWAITING_APPROVAL", "AUTHORIZED"] }, expiresAt: { lte: now },
  }, select: { id: true, state: true }, take: limit, orderBy: { createdAt: "asc" } });
  let expired = 0, recovered = 0, uncertain = 0;
  for (const op of previews) {
    const result = await prisma.agentOperation.updateMany({ where: {
      id: op.id, state: op.state, expiresAt: { lte: now },
    }, data: { state: "EXPIRED", failureCode: "PREVIEW_EXPIRED", finishedAt: now } });
    expired += result.count;
    if (result.count) await prisma.staffTask.updateMany({
      where: { sourceKey: "assistant-action:" + op.id, completedAt: null },
      data: { completedAt: now, version: { increment: 1 } },
    });
  }
  const stalled = await prisma.agentOperation.findMany({ where: {
    state: "RUNNING", leaseExpiresAt: { lte: now },
  }, select: { id: true }, take: limit, orderBy: { createdAt: "asc" } });
  for (const op of stalled) {
    await prisma.agentOperation.updateMany({ where: {
      id: op.id, state: "RUNNING", leaseExpiresAt: { lte: now },
    }, data: { state: "UNKNOWN", leaseToken: null, leaseExpiresAt: null, failureCode: "LEASE_EXPIRED" } });
  }
  const unknowns = await prisma.agentOperation.findMany({ where: { state: "UNKNOWN" },
    include: { connection: true }, take: limit, orderBy: { createdAt: "asc" } });
  for (const op of unknowns) {
    if (!op.verifyIntent || !op.startedAt || !journalActionPolicy(op.action as JournalAction)) {
      uncertain++;
      await recordSystemIssue({ kind: "ASSISTANT_ACTION_UNCERTAIN", operationId: op.id });
      continue;
    }
    const ctx: AgentContext = { userId: op.actorUserId, name: "", role: "OWNER",
      connectionId: op.connectionId, connectionLabel: op.connection.label, scopes: [] };
    try {
      const check = await verifyAgentAction(ctx, op.action as JournalAction,
        op.verifyIntent, op.id, op.startedAt, op.safeResult);
      if (!check.ok) { uncertain++; await recordSystemIssue({
        kind: "ASSISTANT_ACTION_UNCERTAIN", operationId: op.id,
      }); continue; }
      const corrected = await prisma.$transaction(async (tx) => {
        await lockOperation(tx, op.id);
        const latest = await tx.agentOperation.findUniqueOrThrow({ where: { id: op.id } });
        if (latest.state !== "UNKNOWN" || latest.leaseToken) return 0;
        await tx.agentOperation.update({ where: { id: op.id }, data: {
          state: "SUCCEEDED", failureCode: null, finishedAt: now,
          verification: { ...check.observed, checkedAt: now.toISOString(), reconciled: true },
        } });
        await tx.auditLog.create({ data: { userId: op.actorUserId, action: "mcp.operation.succeeded",
          entityType: "AgentOperation", entityId: op.id,
          newValue: { action: op.action, targetRef: op.targetRef, reconciled: true } } });
        return 1;
      });
      recovered += corrected;
      if (corrected) await resolveSystemIssue("assistant-action:" + op.id, "SOURCE_SUCCEEDED");
    } catch {
      uncertain++;
      await recordSystemIssue({ kind: "ASSISTANT_ACTION_UNCERTAIN", operationId: op.id });
    }
  }
  return { expired, recovered, uncertain };
}
