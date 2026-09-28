import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { canTransitionApplianceStatus, applianceStatusAfterInspection, DEFAULT_INSPECTION_CHECKLIST } from "./lifecycle";
import { getBusinessSettings } from "@/domains/settings";

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
 * "Swap for a working unit" — before this existed, there was no way to
 * actually carry out a swap short of editing the database by hand:
 * ApplianceAssignment had no reassignment path at all. This does the
 * whole thing atomically:
 *   1. Unassigns the broken appliance from its rental line.
 *   2. Assigns the replacement to that same line instead.
 *   3. Moves the broken one to MAINTENANCE (it's coming back broken,
 *      not for a routine inspection — see docs/BUSINESS-RULES.md's
 *      rental lifecycle for why AWAITING_INSPECTION doesn't fit here).
 *   4. Moves the replacement to RESERVED — same convention as a brand
 *      new agreement (assigned but not yet physically delivered); Chris
 *      marks it RENTED himself once the SWAP job is actually completed,
 *      same as the job page already suggests (SUGGESTED_STATUS_FOR_TYPE).
 *   5. Creates one SWAP job carrying both appliances, linked to the
 *      customer/agreement/address the broken unit was rented under.
 *
 * Requires the appliance actually be on an active assignment (nothing to
 * swap it out of otherwise — use "Start a repair" instead for a unit
 * that isn't currently rented) and the replacement be AVAILABLE and the
 * same appliance type.
 */
export async function startSwapForAppliance(
  userId: string,
  oldApplianceId: string,
  replacementApplianceId: string,
): Promise<StartSwapResult> {
  if (oldApplianceId === replacementApplianceId) {
    throw new Error("Pick a different unit to swap in — not the same one.");
  }

  const [oldAppliance, replacement, assignment] = await Promise.all([
    prisma.appliance.findUniqueOrThrow({ where: { id: oldApplianceId } }),
    prisma.appliance.findUniqueOrThrow({ where: { id: replacementApplianceId } }),
    findCurrentAssignment(oldApplianceId),
  ]);

  if (!assignment) {
    throw new Error(
      "This appliance isn't currently on an active rental — there's nothing to swap it out of. Use \"Start a repair\" instead.",
    );
  }
  if (replacement.applianceTypeId !== oldAppliance.applianceTypeId) {
    throw new Error("The replacement must be the same appliance type.");
  }
  if (replacement.status !== "AVAILABLE") {
    throw new Error("The replacement unit isn't currently available.");
  }

  const oldCheck = canTransitionApplianceStatus(oldAppliance.status, "MAINTENANCE");
  if (!oldCheck.ok) {
    throw new Error(oldCheck.reason);
  }
  const newCheck = canTransitionApplianceStatus(replacement.status, "RESERVED");
  if (!newCheck.ok) {
    throw new Error(newCheck.reason);
  }

  const agreement = assignment.rentalLine.agreement;

  const jobId = await prisma.$transaction(async (tx: Tx) => {
    const unassigned = await tx.applianceAssignment.updateMany({
      where: { id: assignment.id, unassignedAt: null },
      data: { unassignedAt: new Date(), unassignReason: "Swapped out for repair" },
    });
    if (unassigned.count !== 1) {
      throw new Error("This appliance's assignment just changed — refresh and try again.");
    }

    await tx.applianceAssignment.create({
      data: { rentalLineId: assignment.rentalLineId, applianceId: replacementApplianceId },
    });

    const oldMoved = await tx.appliance.updateMany({
      where: { id: oldApplianceId, status: oldAppliance.status },
      data: { status: "MAINTENANCE" },
    });
    if (oldMoved.count !== 1) {
      throw new Error("This appliance was just changed by someone else — refresh and try again.");
    }

    const newMoved = await tx.appliance.updateMany({
      where: { id: replacementApplianceId, status: replacement.status },
      data: { status: "RESERVED" },
    });
    if (newMoved.count !== 1) {
      throw new Error("The replacement unit was just changed by someone else — refresh and try again.");
    }

    const job = await tx.job.create({
      data: {
        type: "SWAP",
        scheduledAt: new Date(),
        customerId: agreement.customerId,
        serviceAddressId: agreement.serviceAddressId,
        agreementId: agreement.id,
        appliances: {
          create: [{ applianceId: oldApplianceId }, { applianceId: replacementApplianceId }],
        },
      },
    });

    for (const [id, before, after] of [
      [oldApplianceId, oldAppliance.status, "MAINTENANCE"],
      [replacementApplianceId, replacement.status, "RESERVED"],
    ] as const) {
      await tx.auditLog.create({
        data: {
          userId,
          action: "appliance.unit.status",
          entityType: "Appliance",
          entityId: id,
          oldValue: { status: before },
          newValue: { status: after, reason: "Swap started", jobId: job.id },
        },
      });
    }

    return job.id;
  });

  return { jobId };
}

/** This appliance's own inspection checklist — Chris's customized one
 * from /desk/settings if he's set one, otherwise the built-in default
 * (DEFAULT_INSPECTION_CHECKLIST). Used to render the "Record inspection"
 * guided action's checklist. */
export async function getInspectionChecklist(): Promise<string[]> {
  const settings = await getBusinessSettings();
  const custom = Array.isArray(settings.inspectionChecklist)
    ? (settings.inspectionChecklist as unknown[]).filter((i): i is string => typeof i === "string")
    : [];
  return custom.length > 0 ? custom : DEFAULT_INSPECTION_CHECKLIST;
}

/**
 * "Record inspection" — the guided version of moving an appliance out of
 * AWAITING_INSPECTION, which the raw status buttons already technically
 * allowed (straight to AVAILABLE or MAINTENANCE) but with no record of
 * what was actually checked. This creates the ApplianceInspection row
 * (the checklist as answered, Chris's notes, pass/fail) and moves the
 * status in the same transaction — applianceStatusAfterInspection is the
 * one place that decides which way a pass/fail goes, so this can never
 * disagree with what the appliance page itself would otherwise suggest.
 */
export async function recordApplianceInspection(
  userId: string,
  applianceId: string,
  input: { passed: boolean; checklist: { item: string; checked: boolean }[]; notes?: string; condition?: string },
): Promise<void> {
  const appliance = await prisma.appliance.findUniqueOrThrow({ where: { id: applianceId } });
  if (appliance.status !== "AWAITING_INSPECTION") {
    throw new Error("This appliance isn't currently awaiting inspection.");
  }

  const nextStatus = applianceStatusAfterInspection(input.passed);
  const check = canTransitionApplianceStatus(appliance.status, nextStatus);
  if (!check.ok) {
    throw new Error(check.reason);
  }

  await prisma.$transaction(async (tx: Tx) => {
    await tx.applianceInspection.create({
      data: {
        applianceId,
        passed: input.passed,
        checklist: input.checklist,
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
        newValue: { status: nextStatus, reason: input.passed ? "Inspection passed" : "Inspection failed" },
      },
    });
  });
}

export type ApplianceHistoryEntry = {
  id: string;
  kind: "status_change" | "job" | "inspection";
  summary: string;
  detail: string | null;
  createdAt: Date;
};

/** One chronological history for an appliance's own page: every status
 * change (from the audit log), every job it's been on, and every
 * recorded inspection — merged and sorted, newest first. */
export async function getApplianceHistory(applianceId: string): Promise<ApplianceHistoryEntry[]> {
  const [auditEntries, jobLinks, inspections] = await Promise.all([
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
  ]);

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

  return [...statusEntries, ...jobEntries, ...inspectionEntries]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100);
}
