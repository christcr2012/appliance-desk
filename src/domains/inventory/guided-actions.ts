import { prisma } from "@/lib/prisma";
import { formatBusinessDate } from "@/lib/business-date";
import type { Prisma } from "@prisma/client";
import { assertStatusChangeKeepsCustody, getOpenCustody } from "./custody";
import { assertActiveTeamActor, type TeamRole } from "@/lib/team-actor";
import { assertJobScopeInTx } from "@/domains/jobs/scope";
import { createHash } from "node:crypto";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { lockRentalAgreementInTx } from "@/domains/agreements";
import { canTransitionApplianceStatus, applianceStatusAfterInspection } from "./lifecycle";

// ---------------------------------------------------------------------------
// Appliance guided actions (2026-09-28) — the multi-step things Chris
// already had to do by hand from an appliance's own page, done atomically
// in one click instead: start a repair (create the maintenance job AND
// move the status, together, so they can't drift apart), retire a unit
// (with a required reason, since it's terminal), and swap a broken unit
// out for a working one on an active rental (there was previously no way
// to actually do this at all short of manual database changes — see
// findCurrentAssignment's own comment).
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** The rental line (and through it, the agreement/customer/service
 * address) this appliance is currently assigned to, if any — used to
 * link a guided repair/swap job to the right customer automatically,
 * and required for a swap (an appliance with nothing to swap it out of
 * can't be swapped). Returns null for an appliance that isn't currently
 * on an active assignment (e.g. still sitting AVAILABLE). */
async function findCurrentAssignment(applianceId: string) {
  return prisma.applianceAssignment.findFirst({
    where: { applianceId, unassignedAt: null },
    include: {
      rentalLine: {
        include: {
          agreement: {
            include: {
              customer: true,
              serviceAddress: true,
            },
          },
        },
      },
    },
  });
}

export type StartRepairResult = { jobId: string };

/**
 * "Start a repair" — replaces a two-step manual process (change the
 * appliance's status, then separately go create a maintenance job for
 * it) with one atomic action: creates a MAINTENANCE_VISIT job for this
 * appliance (linked to its current customer/address if it's on an
 * active rental, otherwise just the appliance itself — a repair on a
 * shop-floor unit doesn't need a customer) and moves the appliance to
 * MAINTENANCE, together, so the two can never end up out of sync (a job
 * with no corresponding status change, or vice versa).
 */
export async function startRepairForAppliance(
  userId: string,
  applianceId: string,
  notes?: string,
): Promise<StartRepairResult> {
  const appliance = await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } });

  const check = canTransitionApplianceStatus(appliance.status, "MAINTENANCE");
  if (!check.ok) {
    throw new Error(check.reason);
  }

  const assignment = await findCurrentAssignment(applianceId);

  const jobId = await prisma.$transaction(async (tx: Tx) => {
    const job = await tx.job.create({
      data: {
        type: "MAINTENANCE_VISIT",
        scheduledAt: new Date(),
        customerId: assignment?.rentalLine.agreement.customerId ?? null,
        serviceAddressId: assignment?.rentalLine.agreement.serviceAddressId ?? null,
        agreementId: assignment?.rentalLine.agreementId ?? null,
        notes: notes || null,
        appliances: { create: [{ applianceId }] },
      },
    });

    const moved = await tx.appliance.updateMany({
      where: { id: applianceId, status: appliance.status },
      data: { status: "MAINTENANCE" },
    });
    if (moved.count !== 1) {
      throw new Error("This appliance was just changed by someone else — refresh and try again.");
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: appliance.status },
        newValue: { status: "MAINTENANCE", reason: "Repair started", jobId: job.id },
      },
    });

    return job.id;
  });

  return { jobId };
}

/**
 * "Retire this appliance" — the same terminal move the raw status
 * buttons already allow, but requires a reason (retiring is permanent;
 * an unexplained retirement in the history later is a lot less useful
 * than "compressor failed, not economical to repair"). The reason is
 * recorded both on the appliance's own notes (so it's visible at a
 * glance) and in the audit log entry (so it shows up in the history
 * timeline with its own timestamp).
 */
export async function retireAppliance(
  userId: string,
  applianceId: string,
  reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("A reason is required to retire an appliance.");
  }

  const appliance = await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } });

  const check = canTransitionApplianceStatus(appliance.status, "RETIRED");
  if (!check.ok) {
    throw new Error(check.reason);
  }

  await prisma.$transaction(async (tx: Tx) => {
    await assertStatusChangeKeepsCustody(tx, applianceId, "RETIRED");
    const moved = await tx.appliance.updateMany({
      where: { id: applianceId, status: appliance.status },
      data: {
        status: "RETIRED",
        notes: appliance.notes
          ? `${appliance.notes}\n\nRetired: ${trimmedReason}`
          : `Retired: ${trimmedReason}`,
      },
    });
    if (moved.count !== 1) {
      throw new Error("This appliance was just changed by someone else — refresh and try again.");
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: appliance.status },
        newValue: { status: "RETIRED", reason: trimmedReason },
      },
    });
  });
}

/** Candidate replacement units for a swap — other AVAILABLE appliances
 * of the exact same type, so the guided flow can only offer a genuinely
 * compatible unit (never a dryer offered to replace a washer). */
export async function getSwapCandidates(applianceId: string) {
  const appliance = await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } });
  return prisma.appliance.findMany({
    where: { applianceTypeId: appliance.applianceTypeId, status: "AVAILABLE", id: { not: applianceId } },
    include: { applianceType: true },
    orderBy: [{ assetNumber: "asc" }],
  });
}

export type StartSwapResult = { jobId: string };

/**
 * "Swap for a working unit": stages a SWAP visit. Staging moves nothing physical: it reserves only the
 * replacement unit (marked as owned by this swap) and creates the job. The broken unit stays rented to the
 * customer, with its assignment and custody untouched, until the visit is completed and the technician
 * records what really happened (see `completeJob`), which then moves both units, both custody records and
 * the assignment in one step. Cancelling the job, a no-show, or the agreement ending gives the reservation back.
 *
 * The original must have an open assignment and a recorded holder (custody) for the agreement's customer;
 * the replacement must be AVAILABLE, the same appliance type, and not already reserved by another swap.
 */
export async function stageSwap(
  userId: string,
  input: { originalApplianceId: string; replacementApplianceId: string; scheduledAt: Date | null },
): Promise<StartSwapResult> {
  const { originalApplianceId, replacementApplianceId } = input;
  if (originalApplianceId === replacementApplianceId) {
    throw new Error("Pick a different unit to swap in — not the same one.");
  }

  const peek = await findCurrentAssignment(originalApplianceId);
  if (!peek) {
    throw new Error(
      "This appliance isn't currently on an active rental — there's nothing to swap it out of. Use \"Start a repair\" instead.",
    );
  }
  const customerId = peek.rentalLine.agreement.customerId;
  const agreementId = peek.rentalLine.agreementId;

  const jobId = await prisma.$transaction(async (tx: Tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await lockCustomerLedger(tx, customerId);
    await lockRentalAgreementInTx(tx, agreementId);
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ANY(${[originalApplianceId, replacementApplianceId]}) ORDER BY "id" FOR UPDATE`;

    const [original, replacement, assignment] = await Promise.all([
      tx.appliance.findUniqueOrThrow({ where: { id: originalApplianceId } }),
      tx.appliance.findUniqueOrThrow({ where: { id: replacementApplianceId } }),
      tx.applianceAssignment.findFirst({
        where: { applianceId: originalApplianceId, unassignedAt: null },
        include: { rentalLine: { include: { agreement: true } } },
      }),
    ]);
    if (!assignment || assignment.rentalLine.agreementId !== agreementId) {
      throw new Error("This appliance's rental just changed — refresh and try again.");
    }
    if (replacement.applianceTypeId !== original.applianceTypeId) {
      throw new Error("The replacement must be the same appliance type.");
    }
    if (replacement.status !== "AVAILABLE") {
      throw new Error("The replacement unit isn't currently available.");
    }
    const holder = await getOpenCustody(tx, originalApplianceId);
    if (!holder || holder.customerId !== customerId) {
      throw new Error("This appliance has no customer recorded as holding it. Record who has it on the appliance page first.");
    }
    const alreadyStaged = await tx.jobAppliance.findFirst({
      where: { applianceId: originalApplianceId, role: "PRIMARY", job: { type: "SWAP", status: { in: ["SCHEDULED", "IN_PROGRESS"] } } },
      select: { id: true },
    });
    if (alreadyStaged) throw new Error("A swap is already waiting for this appliance. Finish or cancel it first.");
    const newCheck = canTransitionApplianceStatus(replacement.status, "RESERVED");
    if (!newCheck.ok) throw new Error(newCheck.reason);

    const reserved = await tx.appliance.updateMany({ where: { id: replacementApplianceId, status: "AVAILABLE" }, data: { status: "RESERVED" } });
    if (reserved.count !== 1) throw new Error("The replacement unit was just changed by someone else — refresh and try again.");

    const agreement = assignment.rentalLine.agreement;
    const job = await tx.job.create({
      data: {
        type: "SWAP",
        scheduledAt: input.scheduledAt,
        customerId: agreement.customerId,
        serviceAddressId: agreement.serviceAddressId,
        agreementId: agreement.id,
        appliances: {
          create: [
            { applianceId: originalApplianceId },
            { applianceId: replacementApplianceId, role: "REPLACEMENT", reservationActive: true },
          ],
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: replacementApplianceId,
        oldValue: { status: "AVAILABLE" },
        newValue: { status: "RESERVED", reason: "Swap staged", jobId: job.id },
      },
    });
    return job.id;
  });

  return { jobId };
}

/** The checklist inspections are answered against right now: the highest published version
 * (Batch C P2-E). The id is what a form must send back, so an inspection can't be recorded against
 * a list that changed while the page was open. */
export async function getInspectionChecklist(
  db: Pick<Prisma.TransactionClient, "inspectionChecklistVersion"> = prisma,
): Promise<{ versionId: string; version: number; items: string[] }> {
  const current = await db.inspectionChecklistVersion.findFirst({ orderBy: { version: "desc" } });
  if (!current) throw new Error("No inspection checklist has been published yet.");
  const items = Array.isArray(current.items) ? (current.items as unknown[]).filter((i): i is string => typeof i === "string") : [];
  return { versionId: current.id, version: current.version, items };
}

/** The same bytes the migration hashed for version 1: sha256 of the compact JSON text of the items. */
export function checklistHash(items: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

export class ChecklistVersionError extends Error {
  constructor() {
    super("The checklist changed while this page was open. Reload and answer it again.");
    this.name = "ChecklistVersionError";
  }
}

export type RecordInspectionInput = {
  expectedChecklistVersionId: string;
  /** One answer per item, in the order of the checklist version. */
  answers: readonly boolean[];
  notes?: string;
  condition?: string;
  /** Owner or admin only: pass even though some items are unchecked, and say why. */
  overrideReason?: string;
  /** The job this inspection is done from, when there is one. Staff must name a job they may work. */
  jobId?: string;
};

/**
 * "Record inspection" — the guided version of moving an appliance out of AWAITING_INSPECTION.
 * The result is worked out here, never trusted from the screen: all answers checked is a pass
 * (back to Available), anything else is a fail (to Maintenance) unless an owner or admin passes it
 * on purpose with a written reason. The record keeps the exact checklist it was answered against
 * and can never be edited afterwards (a database rule blocks it); corrections are amendments.
 */
export async function recordApplianceInspection(
  userId: string,
  applianceId: string,
  input: RecordInspectionInput,
): Promise<{ inspectionId: string; passed: boolean; overridden: boolean }> {
  return prisma.$transaction(async (tx: Tx) => {
    const actor = await assertActiveTeamActor(tx, userId);
    if (actor.role === "STAFF") {
      if (!input.jobId) throw new Error("Staff record an inspection from the job it belongs to.");
      await assertJobScopeInTx(tx, { userId, role: "STAFF" }, { jobId: input.jobId, applianceId, write: "INSPECTION" });
    } else if (input.jobId) {
      await assertJobScopeInTx(tx, { userId, role: actor.role as TeamRole }, { jobId: input.jobId, applianceId, write: "INSPECTION" });
    }

    const current = await getInspectionChecklist(tx);
    if (current.versionId !== input.expectedChecklistVersionId) throw new ChecklistVersionError();
    if (input.answers.length !== current.items.length) {
      throw new Error("Answer every item on the checklist.");
    }

    // Lock order: the appliance row, then the custody check that also locks it.
    await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${applianceId} FOR UPDATE`;
    const appliance = await tx.appliance.findUniqueOrThrow({ where: { id: applianceId } });
    if (appliance.status !== "AWAITING_INSPECTION") {
      throw new Error("This appliance isn't currently awaiting inspection.");
    }

    const allChecked = input.answers.every((a) => a === true);
    const overrideReason = input.overrideReason?.trim() || null;
    let overridden = false;
    if (!allChecked && overrideReason) {
      if (actor.role === "STAFF") throw new Error("Only an owner or admin can pass an appliance with unchecked items.");
      overridden = true;
    }
    const passed = allChecked || overridden;

    const nextStatus = applianceStatusAfterInspection(passed);
    const check = canTransitionApplianceStatus(appliance.status, nextStatus);
    if (!check.ok) throw new Error(check.reason);
    await assertStatusChangeKeepsCustody(tx, applianceId, nextStatus);

    const inspection = await tx.applianceInspection.create({
      data: {
        applianceId,
        passed,
        checklist: current.items.map((item, i) => ({ item, checked: input.answers[i] === true })),
        checklistDefinition: current.items,
        checklistVersionId: current.versionId,
        jobId: input.jobId ?? null,
        overrideReason: overridden ? overrideReason : null,
        overriddenByUserId: overridden ? userId : null,
        notes: input.notes?.trim() || null,
        condition: input.condition?.trim() || null,
        inspectedById: userId,
      },
    });

    const moved = await tx.appliance.updateMany({
      where: { id: applianceId, status: "AWAITING_INSPECTION" },
      data: { status: nextStatus, condition: input.condition?.trim() || appliance.condition },
    });
    if (moved.count !== 1) {
      throw new Error("This appliance was just changed by someone else — refresh and try again.");
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.unit.status",
        entityType: "Appliance",
        entityId: applianceId,
        oldValue: { status: "AWAITING_INSPECTION" },
        newValue: { status: nextStatus, reason: overridden ? "Inspection passed by override" : passed ? "Inspection passed" : "Inspection failed" },
      },
    });
    if (overridden) {
      await tx.auditLog.create({
        data: {
          userId,
          action: "inspection.override",
          entityType: "ApplianceInspection",
          entityId: inspection.id,
          newValue: { applianceId, reason: overrideReason, uncheckedItems: current.items.filter((_, i) => input.answers[i] !== true) },
        },
      });
    }
    return { inspectionId: inspection.id, passed, overridden };
  });
}

/** A correction to a recorded inspection. The inspection stays exactly as it was; this adds a dated note. Owner or admin. */
export async function amendApplianceInspection(userId: string, inspectionId: string, note: string): Promise<{ amendmentId: string }> {
  const text = note.trim();
  if (!text) throw new Error("Write what is being corrected.");
  if (text.length > 2000) throw new Error("Keep the correction under 2000 characters.");
  return prisma.$transaction(async (tx: Tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const inspection = await tx.applianceInspection.findUnique({ where: { id: inspectionId }, select: { id: true, applianceId: true } });
    if (!inspection) throw new Error("Couldn't find that inspection.");
    const amendment = await tx.applianceInspectionAmendment.create({ data: { inspectionId, note: text, createdByUserId: userId } });
    await tx.auditLog.create({
      data: { userId, action: "inspection.amend", entityType: "ApplianceInspection", entityId: inspectionId, newValue: { amendmentId: amendment.id, applianceId: inspection.applianceId } },
    });
    return { amendmentId: amendment.id };
  });
}

export type ApplianceHistoryEntry = {
  id: string;
  kind: "status_change" | "job" | "inspection" | "custody";
  summary: string;
  detail: string | null;
  createdAt: Date;
};

/** One chronological history for an appliance's own page: every status
 * change (from the audit log), every job it's been on, and every
 * recorded inspection — merged and sorted, newest first. */
export async function getApplianceHistory(applianceId: string): Promise<ApplianceHistoryEntry[]> {
  const [auditEntries, jobLinks, inspections, custody] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "Appliance", entityId: applianceId },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
    prisma.jobAppliance.findMany({
      where: { applianceId },
      include: { job: true },
      orderBy: [{ job: { createdAt: "desc" } }],
    }),
    prisma.applianceInspection.findMany({
      where: { applianceId },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.applianceCustodyEpisode.findMany({
      where: { applianceId },
      include: { customer: { select: { user: { select: { name: true, email: true } } } } },
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);

  const custodyEntries: ApplianceHistoryEntry[] = custody.flatMap((e) => {
    const who = e.customer.user.name ?? e.customer.user.email;
    const since = e.startedOn ? `since ${formatBusinessDate(e.startedOn)}` : "(start date unknown)";
    const rows: ApplianceHistoryEntry[] = [
      {
        id: `custody-start-${e.id}`,
        kind: "custody",
        summary: `With ${who} ${since}`,
        detail: e.startEvidence === "JOB" ? null : e.startEvidence === "MANUAL" ? "Recorded by hand." : "Estimated from an old record.",
        createdAt: e.createdAt,
      },
    ];
    if (e.closedAt) {
      rows.push({
        id: `custody-end-${e.id}`,
        kind: "custody",
        summary: `Back from ${who}${e.endedOn ? ` on ${formatBusinessDate(e.endedOn)}` : ""}`,
        detail: e.endReason,
        createdAt: e.closedAt,
      });
    }
    return rows;
  });

  const statusEntries: ApplianceHistoryEntry[] = auditEntries.map((entry) => {
    const newValue = (entry.newValue ?? {}) as { status?: string; reason?: string };
    return {
      id: `audit-${entry.id}`,
      kind: "status_change",
      summary: newValue.status ? `Status changed to ${newValue.status}` : entry.action,
      detail: newValue.reason ?? null,
      createdAt: entry.createdAt,
    };
  });

  const jobEntries: ApplianceHistoryEntry[] = jobLinks.map((link) => ({
    id: `job-${link.job.id}`,
    kind: "job",
    summary: `${link.job.type.replace(/_/g, " ").toLowerCase()} job — ${link.job.status.replace(/_/g, " ").toLowerCase()}`,
    detail: link.job.completionNotes,
    createdAt: link.job.createdAt,
  }));

  const inspectionEntries: ApplianceHistoryEntry[] = inspections.map((i) => ({
    id: `inspection-${i.id}`,
    kind: "inspection",
    summary: i.passed ? "Inspection passed" : "Inspection failed",
    detail: i.notes,
    createdAt: i.createdAt,
  }));

  return [...statusEntries, ...jobEntries, ...inspectionEntries, ...custodyEntries]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100);
}
