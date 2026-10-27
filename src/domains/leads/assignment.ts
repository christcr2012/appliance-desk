import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jobRoleAllowsScreen } from "@/domains/team/job-role-rules";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockLiveLeadInTx } from "./lock";

/**
 * LD-1: who owns a new lead. Assignable people are active OWNER, ADMIN and
 * STAFF users whose job role allows the `leads` screen (answered by Chris
 * 2026-10-26, DQ-LD1-1: staff with the Leads screen can be given leads; a
 * person with no job role is decided by their access level alone). Ordered by
 * account age, then id.
 */
export type LeadAssignmentMode = "OWNER" | "PERSON" | "ROTATE";

export async function assignableLeadOwners(
  tx: Prisma.TransactionClient,
): Promise<{ id: string; name: string }[]> {
  const users = await tx.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "STAFF"] }, archivedAt: null },
    select: { id: true, name: true, email: true, role: true, jobRoleId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const roleIds = [...new Set(users.map((u) => u.jobRoleId).filter((x): x is string => Boolean(x)))];
  const roles = roleIds.length
    ? await tx.jobRole.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, screens: true, accessLevel: true, archivedAt: true },
      })
    : [];
  const byId = new Map(roles.map((r) => [r.id, r]));
  return users
    .filter((u) => {
      if (!u.jobRoleId) return true;
      const role = byId.get(u.jobRoleId);
      // A job role that is gone, archived, or no longer matches the person's
      // level grants nothing: fail closed, the person is not assignable.
      if (!role || role.archivedAt || role.accessLevel !== u.role) return false;
      const screens = Array.isArray(role.screens)
        ? role.screens.filter((s): s is string => typeof s === "string")
        : [];
      return jobRoleAllowsScreen(screens, "leads");
    })
    .map((u) => ({ id: u.id, name: u.name || u.email }));
}

/** The oldest active OWNER who can be given leads (null when there is none). */
async function oldestOwnerId(tx: Prisma.TransactionClient): Promise<string | null> {
  const owners = await tx.user.findMany({
    where: { role: "OWNER", archivedAt: null },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (owners.length === 0) return null;
  const assignable = new Set((await assignableLeadOwners(tx)).map((o) => o.id));
  return owners.find((o) => assignable.has(o.id))?.id ?? null;
}

/**
 * LD-1: serialize lead creation on the settings row. Every create takes
 * this lock before its duplicate check, so two creates of the same phone
 * or email cannot both read "no match" and both insert unflagged: the
 * second create's check runs only after the first create has committed.
 * chooseOwnerForNewLeadInTx takes the same lock again to pick the owner
 * (a no-op inside a transaction that already holds it).
 */
export async function lockLeadAssignmentInTx(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE
  `;
}

/**
 * Picks the owner for a new lead, inside the lead's own create transaction.
 * Locks the settings row first, so two leads created at the same moment in
 * ROTATE mode get different people. Returns null only when nobody can be
 * given leads (no active owner or admin); the lead is still created.
 */
export async function chooseOwnerForNewLeadInTx(
  tx: Prisma.TransactionClient,
): Promise<string | null> {
  await lockLeadAssignmentInTx(tx);
  const settings = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const mode = (settings.leadAssignmentMode ?? "OWNER") as LeadAssignmentMode;
  const owners = await assignableLeadOwners(tx);
  if (owners.length === 0) return null;
  if (mode === "PERSON" && settings.leadAssignmentUserId) {
    const chosen = owners.find((o) => o.id === settings.leadAssignmentUserId);
    if (chosen) return chosen.id;
    // The chosen person can no longer be given leads: fall back to the owner.
  }
  if (mode === "ROTATE") {
    const cursor = settings.leadRotationCursor;
    const at = cursor ? owners.findIndex((o) => o.id === cursor) : -1;
    const next = owners[(at + 1) % owners.length]!;
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: { leadRotationCursor: next.id },
    });
    return next.id;
  }
  return oldestOwnerId(tx);
}

/** OWNER/ADMIN moves a lead to another assignable person (or nobody). Audited `lead.assign`. */
export async function reassignLead(
  actorId: string,
  leadId: string,
  toUserId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const before = await lockLiveLeadInTx(tx, leadId);
    if (toUserId) {
      const owners = await assignableLeadOwners(tx);
      if (!owners.some((o) => o.id === toUserId)) {
        throw new Error("That person can't be given leads.");
      }
    }
    await tx.lead.update({ where: { id: leadId }, data: { assignedToUserId: toUserId } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "lead.assign",
        entityType: "Lead",
        entityId: leadId,
        oldValue: { assignedToUserId: before.assignedToUserId },
        newValue: { assignedToUserId: toUserId },
      },
    });
  });
}

/** The assignment setting as the lead-response page shows it, with the people it can pick from. */
export async function getLeadAssignment(): Promise<{
  mode: LeadAssignmentMode;
  personId: string | null;
  people: { id: string; name: string }[];
}> {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    return {
      mode: (settings.leadAssignmentMode ?? "OWNER") as LeadAssignmentMode,
      personId: settings.leadAssignmentUserId,
      people: await assignableLeadOwners(tx),
    };
  });
}

/**
 * OWNER-only, audited `settings.lead_assignment`, compare-and-set on the
 * values the screen showed (a save from a stale page is refused). PERSON
 * needs a person who can still be given leads.
 */
export async function saveLeadAssignment(
  actorId: string,
  input: { mode: LeadAssignmentMode; personId: string | null },
  expected: { mode: LeadAssignmentMode; personId: string | null },
): Promise<void> {
  if (!["OWNER", "PERSON", "ROTATE"].includes(input.mode)) {
    throw new Error("Choose who new leads go to.");
  }
  if (input.mode === "PERSON" && !input.personId) {
    throw new Error("Choose the person new leads go to.");
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    if (input.mode === "PERSON") {
      const owners = await assignableLeadOwners(tx);
      if (!owners.some((o) => o.id === input.personId)) {
        throw new Error("That person can't be given leads.");
      }
    }
    const changed = await tx.businessSettings.updateMany({
      where: {
        id: "singleton",
        leadAssignmentMode: expected.mode,
        leadAssignmentUserId: expected.personId,
      },
      data: {
        leadAssignmentMode: input.mode,
        leadAssignmentUserId: input.mode === "PERSON" ? input.personId : null,
      },
    });
    if (changed.count !== 1) {
      throw new Error("This setting was changed in another session. Reload before saving.");
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "settings.lead_assignment",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { leadAssignmentMode: expected.mode, leadAssignmentUserId: expected.personId },
        newValue: {
          leadAssignmentMode: input.mode,
          leadAssignmentUserId: input.mode === "PERSON" ? input.personId : null,
        },
      },
    });
  });
}
