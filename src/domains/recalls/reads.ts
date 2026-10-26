// OPS-1: read-only queries for the Recalls screens. Owner and admin only (the pages gate the role).
import { prisma } from "@/lib/prisma";
import type { RecallMatchState } from "@prisma/client";

export type RecallSummary = {
  recallId: string;
  recallNumber: string;
  title: string;
  publishedAt: Date | null;
  counts: Record<RecallMatchState, number>;
};

const EMPTY: Record<RecallMatchState, number> = { POSSIBLE: 0, CONFIRMED: 0, NOT_OURS: 0, REMEDIED: 0 };

export async function listRecallSummaries(): Promise<RecallSummary[]> {
  const rows = await prisma.recallMatch.groupBy({
    by: ["recallId", "recallNumber", "title", "publishedAt", "state"],
    _count: { _all: true },
    orderBy: [{ publishedAt: "desc" }, { recallId: "asc" }],
    take: 300,
  });
  const byRecall = new Map<string, RecallSummary>();
  for (const row of rows) {
    const existing = byRecall.get(row.recallId) ?? {
      recallId: row.recallId, recallNumber: row.recallNumber, title: row.title, publishedAt: row.publishedAt, counts: { ...EMPTY },
    };
    existing.counts[row.state] += row._count._all;
    byRecall.set(row.recallId, existing);
  }
  return [...byRecall.values()];
}

export type RecallDetail = {
  recallId: string;
  recallNumber: string;
  title: string;
  url: string;
  hazard: string | null;
  remedy: string | null;
  publishedAt: Date | null;
  matches: Array<{
    id: string;
    state: RecallMatchState;
    matchReason: string;
    decisionNote: string | null;
    decidedAt: Date | null;
    appliance: { id: string; assetNumber: string; typeName: string; manufacturer: string | null; model: string | null; serialNumber: string | null; recallHold: boolean };
    renters: string[];
  }>;
};

export async function getRecallDetail(recallId: string): Promise<RecallDetail | null> {
  const matches = await prisma.recallMatch.findMany({
    where: { recallId },
    orderBy: [{ appliance: { assetNumber: "asc" } }],
    take: 200,
    include: {
      appliance: {
        select: {
          id: true, assetNumber: true, manufacturer: true, model: true, serialNumber: true, recallHold: true,
          applianceType: { select: { name: true } },
          assignments: {
            where: { unassignedAt: null, rentalLine: { agreement: { status: "ACTIVE" } } },
            select: { rentalLine: { select: { agreement: { select: { customer: { select: { user: { select: { name: true, email: true } } } } } } } } },
          },
        },
      },
    },
  });
  const first = matches[0];
  if (!first) return null;
  return {
    recallId: first.recallId, recallNumber: first.recallNumber, title: first.title, url: first.url,
    hazard: first.hazard, remedy: first.remedy, publishedAt: first.publishedAt,
    matches: matches.map((match) => ({
      id: match.id, state: match.state, matchReason: match.matchReason, decisionNote: match.decisionNote, decidedAt: match.decidedAt,
      appliance: {
        id: match.appliance.id, assetNumber: match.appliance.assetNumber, typeName: match.appliance.applianceType.name,
        manufacturer: match.appliance.manufacturer, model: match.appliance.model, serialNumber: match.appliance.serialNumber,
        recallHold: match.appliance.recallHold,
      },
      renters: [...new Set(match.appliance.assignments.map((row) => {
        const user = row.rentalLine.agreement.customer.user;
        return user.name ?? user.email;
      }))],
    })),
  };
}

export async function getWatchStatus() {
  const [state, fleetSize] = await Promise.all([
    prisma.recallWatchState.findUnique({ where: { id: "singleton" } }),
    prisma.appliance.count({ where: { archivedAt: null } }),
  ]);
  return { state, fleetSize };
}

export async function getSafetyIncident(id: string) {
  return prisma.safetyIncident.findUnique({
    where: { id },
    include: { appliance: { select: { id: true, assetNumber: true, applianceType: { select: { name: true } } } } },
  });
}

export async function listApplianceTypeTerms() {
  return prisma.applianceType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, recallProductTerms: true },
  });
}

/** Chris edits the words used to search the recall list for one kind of appliance. */
export async function setRecallTerms(actorUserId: string, applianceTypeId: string, raw: string): Promise<string[]> {
  const terms = [...new Set(raw.split(/[\n,]/).map((term) => term.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  if (terms.some((term) => term.length > 60)) throw new Error("Each search word can be up to 60 letters.");
  const { assertActiveTeamActor } = await import("@/lib/team-actor");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "ApplianceType" WHERE "id" = ${applianceTypeId} FOR UPDATE`;
    const before = await tx.applianceType.findUnique({ where: { id: applianceTypeId }, select: { recallProductTerms: true } });
    if (!before) throw new Error("Couldn't find that kind of appliance.");
    await tx.applianceType.update({ where: { id: applianceTypeId }, data: { recallProductTerms: terms } });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "recall.terms.set", entityType: "ApplianceType", entityId: applianceTypeId, oldValue: { terms: before.recallProductTerms }, newValue: { terms } },
    });
  });
  return terms;
}
