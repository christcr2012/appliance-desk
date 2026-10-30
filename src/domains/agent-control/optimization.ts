import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { SETTING_ROWS } from "@/domains/settings/catalog";
import { safeRepairInstruction } from "./repair-cases";
import { getObservations, safePerformanceName, type ObservationWindow,
  type PerformanceKind } from "./performance";

export type ProposalInput = {
  title: string; observation: { window: ObservationWindow; kind: PerformanceKind; name: string };
  settingKeys: string[]; expectedBenefit: string; risk: string; costNote: string;
  measurementPlan: string; rollback: string;
};

/** No tuning permission is granted by this proposal. Prices/taxes/legal values are excluded. */
export function checkOptimizationTargets(keys: readonly string[]): void {
  if (keys.length > 12 || new Set(keys).size !== keys.length) throw new Error("INVALID_OPTIMIZATION_TARGETS");
  for (const key of keys) {
    const row = SETTING_ROWS.find(item => item.key === key);
    if (!row) throw new Error("UNKNOWN_SETTING_KEY");
    if (row.kind === "money" || ["prices", "money", "rentals", "decisions"].includes(row.section) ||
        /tax|fee|price|legal|terms|sign|money|bill|refund|charge|rent|contract/i.test(row.key))
      throw new Error("PROTECTED_SETTING_KEY");
  }
}

function safeText(raw: string, max: number): string {
  return safeRepairInstruction(raw).slice(0, max);
}

/** Owner-only: snapshot an observed baseline, never execute a suggested edit. */
export async function createOptimizationProposal(ownerId: string, input: ProposalInput, options: { now?: Date } = {}) {
  checkOptimizationTargets(input.settingKeys);
  if (!safePerformanceName(input.observation.kind, input.observation.name))
    throw new Error("UNKNOWN_PERFORMANCE_LABEL");
  if (input.observation.window !== "7d" && input.observation.window !== "30d")
    throw new Error("INVALID_OBSERVATION_WINDOW");
  const title = safeText(input.title, 160);
  const expectedBenefit = safeText(input.expectedBenefit, 2000);
  const risk = safeText(input.risk, 2000);
  const costNote = safeText(input.costNote, 500);
  const measurementPlan = safeText(input.measurementPlan, 2000);
  const rollback = safeText(input.rollback, 2000);
  const evidence = await getObservations({ window: input.observation.window, kind: input.observation.kind, now: options.now });
  const baseline = evidence.rows.find(row => row.name === input.observation.name);
  if (!baseline || baseline.status !== "ENOUGH")
    throw new Error("NOT_ENOUGH_PERFORMANCE_EVIDENCE");
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    const proposal = await tx.optimizationProposal.create({ data: {
      title, expectedBenefit, risk, costNote, measurementPlan, rollback,
      createdByUserId: ownerId, state: "PROPOSED",
      observationRefs: { baseline, selectedSettingKeys: input.settingKeys,
        window: evidence.window, start: evidence.start, end: evidence.end } as Prisma.InputJsonValue,
    } });
    await tx.auditLog.create({ data: {
      userId: ownerId, action: "mcp.optimization.proposed",
      entityType: "OptimizationProposal", entityId: proposal.id,
      newValue: { number: proposal.number, name: input.observation.name, samples: baseline.samples },
    } });
    return { id: proposal.id, number: proposal.number, state: proposal.state, title: proposal.title };
  });
}

export async function listOptimizationProposals(userId: string, limit = 20) {
  await prisma.$transaction(tx => assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]));
  return prisma.optimizationProposal.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(limit, 25)),
    select: { id: true, number: true, title: true, state: true, createdAt: true, expectedBenefit: true,
      risk: true, measurementPlan: true, rollback: true, observationRefs: true, repairCaseId: true },
  });
}

export async function decideOptimizationProposal(ownerId: string, input: {
  id: string; accept: boolean;
}, options: { deployedRevision?: string } = {}) {
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "OptimizationProposal" WHERE "id" = ${input.id} FOR UPDATE`;
    const current = await tx.optimizationProposal.findUnique({ where: { id: input.id } });
    if (!current || current.state !== "PROPOSED") throw new Error("PROPOSAL_NOT_PENDING");
    // This owner decision creates only an engineering case, never a setting edit.
    // Provenance is the persisted proposal, not untrusted case arguments.
    let repairCaseId: string | null = null;
    if (input.accept) {
      const revision = options.deployedRevision ?? process.env.VERCEL_GIT_COMMIT_SHA;
      if (!revision || !/^[a-f0-9]{40}$/i.test(revision))
        throw new Error("REPAIR_SOURCE_REVISION_UNVERIFIED");
      const fingerprint = createHash("sha256")
        .update("OPTIMIZATION:" + current.id + ":1").digest("hex");
      const repair = await tx.repairCase.upsert({
        where: { fingerprint },
        create: {
          sourceKind: "OPTIMIZATION", sourceId: current.id, sourceVersion: 1,
          fingerprint, title: current.title, expectedBehavior: current.expectedBenefit,
          howToCheck: "After a reviewed deployment, compare 30 or more fresh samples against the stored baseline and measurement plan. Owner verification is required.",
          baselineRevision: revision.toLowerCase(), createdByUserId: ownerId,
        },
        update: {},
      });
      repairCaseId = repair.id;
    }
    const next = await tx.optimizationProposal.update({ where: { id: input.id },
      data: { state: input.accept ? "ACCEPTED" : "REJECTED", repairCaseId } });
    await tx.auditLog.create({ data: {
      userId: ownerId, action: "mcp.optimization.reviewed",
      entityType: "OptimizationProposal", entityId: next.id,
      newValue: { number: next.number, state: next.state, repairCaseId },
    } });
    // This approves review of an engineering proposal, not application of a setting.
    return { id: next.id, number: next.number, state: next.state, repairCaseId };
  });
}
