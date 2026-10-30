import { Prisma } from "@prisma/client";
import type { AgentContext } from "@/domains/agent-control/authorization";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { prisma } from "@/lib/prisma";
import { canTriageMove, checkReason, messageSchema, type FeedbackStateName } from "./rules";

export type FeedbackMutation =
  | { kind: "REPLY"; reportId: string; body: string; visibility: "REPORTER" | "INTERNAL"; expectedVersion: number }
  | { kind: "STATE"; reportId: string; toState: FeedbackStateName; reason: string; expectedVersion: number }
  | { kind: "LINK"; reportId: string; caseId: string; expectedVersion: number };

const cuid = /^c[a-z0-9]{10,50}$/i;
function validate(input: FeedbackMutation) {
  if (!cuid.test(input.reportId) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw new Error("INVALID_FEEDBACK_TARGET");
  if (input.kind === "REPLY") {
    messageSchema.parse(input.body);
    if (!["REPORTER","INTERNAL"].includes(input.visibility)) throw new Error("INVALID_FEEDBACK_VISIBILITY");
  }
  if (input.kind === "STATE") {
    if (!["SUBMITTED","TRIAGED","NEEDS_INFORMATION","ACCEPTED","IN_PROGRESS",
      "AWAITING_VERIFICATION","RESOLVED","DUPLICATE","DECLINED","CLOSED"].includes(input.toState))
      throw new Error("INVALID_FEEDBACK_STATE");
    if (input.reason.length > 500) throw new Error("INVALID_FEEDBACK_REASON");
  }
  if (input.kind === "LINK" && !cuid.test(input.caseId)) throw new Error("INVALID_REPAIR_CASE");
}

async function lock(ctx: AgentContext, tx: Prisma.TransactionClient, reportId: string) {
  await assertActiveTeamActor(tx, ctx.userId, ["OWNER", "ADMIN"]);
  await tx.$queryRaw`SELECT "id" FROM "McpConnection" WHERE "id" = ${ctx.connectionId} FOR SHARE`;
  const connection = await tx.mcpConnection.findUnique({ where: { id: ctx.connectionId },
    select: { userId: true, revokedAt: true, scopes: true } });
  if (!connection || connection.revokedAt || connection.userId !== ctx.userId ||
      !connection.scopes.includes("feedback:triage") || !ctx.scopes.includes("feedback:triage"))
    throw new Error("FORBIDDEN_SCOPE");
  await tx.$queryRaw`SELECT "id" FROM "FeedbackReport" WHERE "id" = ${reportId} FOR UPDATE`;
  const report = await tx.feedbackReport.findUnique({ where: { id: reportId },
    select: { id: true, version: true, state: true, aiReview: true, contentRemovedAt: true } });
  if (!report || report.aiReview !== "ALLOWED" || report.contentRemovedAt)
    throw new Error("FEEDBACK_PERMISSION_WITHDRAWN");
  return report;
}

/** Called at PREVIEW and again inside the dispatch TX. Never trust a stored preview for consent. */
export async function previewFeedbackMutation(ctx: AgentContext, input: FeedbackMutation) {
  validate(input);
  return prisma.$transaction(async tx => {
    const report = await lock(ctx, tx, input.reportId);
    if (report.version !== input.expectedVersion) throw new Error("FEEDBACK_CHANGED");
    if (input.kind === "STATE" && !canTriageMove(report.state, input.toState))
      throw new Error("FEEDBACK_STATE_NOT_ALLOWED");
    if (input.kind === "STATE") checkReason(input.toState, input.reason);
    if (input.kind === "LINK") {
      const repair = await tx.repairCase.findUnique({ where: { id: input.caseId },
        select: { sourceKind: true, sourceId: true, stage: true } });
      if (!repair || repair.sourceKind !== "FEEDBACK" || repair.sourceId !== input.reportId)
        throw new Error("REPAIR_CASE_NOT_FOR_REPORT");
    }
    if (input.kind === "STATE" && input.toState === "RESOLVED") {
      const confirmed = await tx.feedbackCaseLink.count({ where: {
        reportId: input.reportId, repairCase: { stage: "VERIFIED" },
      } });
      if (confirmed === 0) throw new Error("VERIFIED_REPAIR_REQUIRED");
    }
    const description = input.kind === "REPLY" ? "A reply is proposed" :
      input.kind === "STATE" ? "A status update is proposed" : "Link a repair case";
    return {
      reportVersion: report.version, reportState: report.state, description,
      caseId: input.kind === "LINK" ? input.caseId : null,
    };
  });
}

/**
 * Journal dispatch calls once with its durable op id. Deterministic IDs make
 * uncertain-result retries idempotent even if journal verification is delayed.
 */
export async function dispatchFeedbackMutation(
  ctx: AgentContext, input: FeedbackMutation, operationId: string,
) {
  validate(input);
  if (!cuid.test(operationId)) throw new Error("INVALID_OPERATION_ID");
  return prisma.$transaction(async tx => {
    const report = await lock(ctx, tx, input.reportId);
    const marker = "mcp-feedback-" + operationId;
    if (input.kind === "REPLY") {
      const entry = await tx.feedbackEntry.findUnique({ where: { id: marker } });
      if (entry) return { entryId: marker, applied: true };
      if (report.version !== input.expectedVersion) throw new Error("FEEDBACK_CHANGED");
      await tx.feedbackEntry.create({ data: {
        id: marker, reportId: report.id, body: input.body, visibility: input.visibility,
        authorUserId: ctx.userId, authorKind: "ASSISTANT", agentConnectionId: ctx.connectionId,
      } });
      await tx.feedbackReport.update({ where: { id: report.id }, data: {
        awaitingTeam: false, version: { increment: 1 },
      } });
      await tx.feedbackEvent.create({ data: {
        reportId: report.id, actorUserId: ctx.userId,
        action: input.visibility === "REPORTER" ? "REPLIED" : "NOTE_ADDED",
      } });
      return { entryId: marker, applied: true };
    }
    if (input.kind === "STATE") {
      const found = await tx.feedbackEvent.findUnique({ where: { id: marker } });
      if (found) return { eventId: marker, applied: true };
      if (report.version !== input.expectedVersion) throw new Error("FEEDBACK_CHANGED");
      if (!canTriageMove(report.state, input.toState)) throw new Error("FEEDBACK_STATE_NOT_ALLOWED");
      const reason = checkReason(input.toState, input.reason);
      if (input.toState === "RESOLVED") {
        const verified = await tx.feedbackCaseLink.count({ where: {
          reportId: report.id, repairCase: { stage: "VERIFIED" },
        } });
        if (!verified) throw new Error("VERIFIED_REPAIR_REQUIRED");
      }
      await tx.feedbackReport.update({ where: { id: report.id }, data: {
        state: input.toState, awaitingTeam: false,
        closedAt: ["RESOLVED","DUPLICATE","DECLINED","CLOSED"].includes(input.toState) ? new Date() : null,
        version: { increment: 1 },
      } });
      await tx.feedbackEvent.create({ data: { id: marker, reportId: report.id,
        actorUserId: ctx.userId, action: "STATE_CHANGED", fromState: report.state,
        toState: input.toState, reason,
      } });
      return { eventId: marker, applied: true };
    }
    const existing = await tx.feedbackCaseLink.findUnique({
      where: { reportId_repairCaseId: { reportId: report.id, repairCaseId: input.caseId } },
    });
    if (existing) return { linkId: existing.id, applied: true };
    if (report.version !== input.expectedVersion) throw new Error("FEEDBACK_CHANGED");
    const repair = await tx.repairCase.findUnique({ where: { id: input.caseId },
      select: { sourceKind: true, sourceId: true } });
    if (!repair || repair.sourceKind !== "FEEDBACK" || repair.sourceId !== report.id)
      throw new Error("REPAIR_CASE_NOT_FOR_REPORT");
    const linked = await tx.feedbackCaseLink.create({ data: {
      id: marker, reportId: report.id, repairCaseId: input.caseId, createdByUserId: ctx.userId,
    } });
    await tx.feedbackReport.update({ where: { id: report.id }, data: {
      version: { increment: 1 },
    } });
    return { linkId: linked.id, applied: true };
  });
}

export async function verifyFeedbackMutation(
  ctx: AgentContext, input: FeedbackMutation, operationId: string,
) {
  // Verification cannot infer success from a reply's contents or its description.
  const marker = "mcp-feedback-" + operationId;
  if (input.kind === "REPLY") return {
    ok: Boolean(await prisma.feedbackEntry.findFirst({ where: {
      id: marker, reportId: input.reportId, authorKind: "ASSISTANT",
      agentConnectionId: ctx.connectionId,
    } })), observed: { operationId },
  };
  if (input.kind === "STATE") return {
    ok: Boolean(await prisma.feedbackEvent.findFirst({ where: {
      id: marker, reportId: input.reportId, action: "STATE_CHANGED",
    } })), observed: { operationId },
  };
  return {
    ok: Boolean(await prisma.feedbackCaseLink.findFirst({ where: {
      id: marker, reportId: input.reportId, repairCaseId: input.caseId,
    } })), observed: { operationId },
  };
}
