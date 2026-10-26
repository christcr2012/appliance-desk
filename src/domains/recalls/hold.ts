// OPS-1: what Chris decides about a possible recall, and what a confirmed recall stops. Every write locks the rows it
// changes, re-checks the person is still active staff, and leaves an audit row. Nothing here sends a message: the notes
// for affected renters are To do items with a drafted message for Chris to review and send himself.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { createTaskInTx } from "@/domains/tasks";
import { RecallError } from "./guard";
import { renterTaskNote } from "./drafts";

export { draftRenterMessage, renterTaskNote } from "./drafts";
export { RecallError, assertNotRecallHeld, assertNotRecalledForSale, notOnRecallHold, type HeldAction } from "./guard";

type Tx = Prisma.TransactionClient;


async function lockMatch(tx: Tx, matchId: string) {
  await tx.$queryRaw`SELECT "id" FROM "RecallMatch" WHERE "id" = ${matchId} FOR UPDATE`;
  const match = await tx.recallMatch.findUnique({ where: { id: matchId }, include: { appliance: { select: { id: true, assetNumber: true } } } });
  if (!match) throw new RecallError("Couldn't find that recall match.");
  await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${match.applianceId} FOR UPDATE`;
  return match;
}

async function syncHold(tx: Tx, applianceId: string): Promise<boolean> {
  const confirmed = await tx.recallMatch.count({ where: { applianceId, state: "CONFIRMED" } });
  await tx.appliance.update({ where: { id: applianceId }, data: { recallHold: confirmed > 0 } });
  return confirmed > 0;
}

/** "It's ours": the recall applies. Puts the machine on hold and makes a To do for each current renter. */
export async function confirmRecallMatch(actorUserId: string, matchId: string, now = new Date()): Promise<{ tasksCreated: number }> {
  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const match = await lockMatch(tx, matchId);
    if (match.state === "CONFIRMED") return { tasksCreated: 0 };
    if (match.state === "REMEDIED") throw new RecallError("This recall was already marked fixed for this machine.");
    await tx.recallMatch.update({
      where: { id: matchId },
      data: { state: "CONFIRMED", decidedByUserId: actorUserId, decidedAt: now, decisionNote: null },
    });
    await syncHold(tx, match.applianceId);
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "recall.confirmed", entityType: "Appliance", entityId: match.applianceId,
        oldValue: { state: match.state }, newValue: { state: "CONFIRMED", recallNumber: match.recallNumber, hold: true },
      },
    });

    const renters = await tx.applianceAssignment.findMany({
      where: { applianceId: match.applianceId, unassignedAt: null, rentalLine: { agreement: { status: "ACTIVE" } } },
      select: { rentalLine: { select: { agreement: { select: { customerId: true, customer: { select: { user: { select: { name: true, email: true } } } } } } } } },
    });
    const seen = new Set<string>();
    let tasksCreated = 0;
    for (const row of renters) {
      const agreement = row.rentalLine.agreement;
      if (seen.has(agreement.customerId)) continue;
      seen.add(agreement.customerId);
      const name = agreement.customer.user.name ?? agreement.customer.user.email;
      const result = await createTaskInTx(tx, { userId: actor.id, role: actor.role as "OWNER" | "ADMIN" | "STAFF" }, {
        note: renterTaskNote({ customerName: name, assetNumber: match.appliance.assetNumber, title: match.title }),
        priority: "HIGH",
        customerId: agreement.customerId,
        applianceId: match.applianceId,
        sourceKey: `recall:${matchId}:${agreement.customerId}`,
      });
      if (result.created) tasksCreated += 1;
    }
    return { tasksCreated };
  });
}

/** "Not ours" (or "I was wrong"): the recall does not apply to this machine. A reason is required. */
export async function markRecallNotOurs(actorUserId: string, matchId: string, reason: string, now = new Date()): Promise<void> {
  const note = reason.trim().slice(0, 300);
  if (!note) throw new RecallError("Say briefly why this recall does not apply (for example: different model number).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const match = await lockMatch(tx, matchId);
    if (match.state === "NOT_OURS") return;
    await tx.recallMatch.update({
      where: { id: matchId },
      data: { state: "NOT_OURS", decidedByUserId: actorUserId, decidedAt: now, decisionNote: note },
    });
    const held = await syncHold(tx, match.applianceId);
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "recall.not_ours", entityType: "Appliance", entityId: match.applianceId,
        oldValue: { state: match.state }, newValue: { state: "NOT_OURS", recallNumber: match.recallNumber, reason: note, hold: held },
      },
    });
  });
}

/** The maker's fix was done on this machine: the hold comes off (unless another confirmed recall still covers it). */
export async function markRecallRemedied(actorUserId: string, matchId: string, note: string, now = new Date()): Promise<void> {
  const text = note.trim().slice(0, 300);
  if (!text) throw new RecallError("Say what was done (for example: repair kit installed on 2026-11-02).");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const match = await lockMatch(tx, matchId);
    if (match.state !== "CONFIRMED") throw new RecallError("Only a confirmed recall can be marked fixed.");
    await tx.recallMatch.update({
      where: { id: matchId },
      data: { state: "REMEDIED", decidedByUserId: actorUserId, decidedAt: now, decisionNote: text },
    });
    const held = await syncHold(tx, match.applianceId);
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "recall.remedied", entityType: "Appliance", entityId: match.applianceId,
        oldValue: { state: "CONFIRMED" }, newValue: { state: "REMEDIED", recallNumber: match.recallNumber, note: text, hold: held },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Injury or safety incident log
// ---------------------------------------------------------------------------
export const CPSC_REPORT_URL = "https://www.saferproducts.gov/";

export async function markSafetyIncident(
  actorUserId: string,
  input: { applianceId?: string | null; maintenanceRequestId?: string | null; jobId?: string | null; description: string },
): Promise<{ id: string; created: boolean }> {
  const description = input.description.trim().slice(0, 1000);
  if (!description) throw new RecallError("Say briefly what happened.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId);
    let applianceId = input.applianceId ?? null;
    // Lock the repair request or visit first, so two people marking the same one at the same moment make one incident.
    if (input.maintenanceRequestId) {
      await tx.$queryRaw`SELECT "id" FROM "MaintenanceRequest" WHERE "id" = ${input.maintenanceRequestId} FOR UPDATE`;
    }
    if (input.jobId) {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${input.jobId} FOR UPDATE`;
    }
    if (input.maintenanceRequestId) {
      const request = await tx.maintenanceRequest.findUnique({ where: { id: input.maintenanceRequestId }, select: { applianceId: true } });
      if (!request) throw new RecallError("Couldn't find that repair request.");
      applianceId = applianceId ?? request.applianceId;
      const existing = await tx.safetyIncident.findFirst({ where: { maintenanceRequestId: input.maintenanceRequestId } });
      if (existing) return { id: existing.id, created: false };
    }
    if (input.jobId) {
      const existing = await tx.safetyIncident.findFirst({ where: { jobId: input.jobId } });
      if (existing) return { id: existing.id, created: false };
    }
    if (applianceId && !(await tx.appliance.findUnique({ where: { id: applianceId }, select: { id: true } }))) {
      throw new RecallError("Couldn't find that appliance.");
    }
    const incident = await tx.safetyIncident.create({
      data: {
        applianceId, maintenanceRequestId: input.maintenanceRequestId ?? null, jobId: input.jobId ?? null,
        description, markedByUserId: actorUserId,
      },
    });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "safety_incident.marked", entityType: "SafetyIncident", entityId: incident.id, newValue: { applianceId, description } },
    });
    return { id: incident.id, created: true };
  });
}

export async function decideSafetyIncident(
  actorUserId: string,
  incidentId: string,
  decision: "REPORTED" | "NOT_REPORTED",
  note: string,
  now = new Date(),
): Promise<void> {
  const text = note.trim().slice(0, 500);
  if (!text) throw new RecallError("Add a short note about what you decided and why.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "SafetyIncident" WHERE "id" = ${incidentId} FOR UPDATE`;
    const incident = await tx.safetyIncident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new RecallError("Couldn't find that incident.");
    if (incident.decision !== "PENDING") return;
    await tx.safetyIncident.update({
      where: { id: incidentId },
      data: { decision, decisionNote: text, decidedByUserId: actorUserId, decidedAt: now },
    });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "safety_incident.decided", entityType: "SafetyIncident", entityId: incidentId, oldValue: { decision: "PENDING" }, newValue: { decision, note: text } },
    });
  });
}
