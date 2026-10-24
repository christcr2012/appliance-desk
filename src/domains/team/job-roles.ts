import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { CAPABILITY_KEYS } from "@/domains/capabilities";
import { noticeWarning } from "@/domains/account";
import { JobRoleError, STARTER_JOB_ROLES, validateJobRole, type JobRoleLevel } from "./job-role-rules";
export { JobRoleError } from "./job-role-rules";

// ACC-5: job roles. A job role only NARROWS what an access level allows (it is a list of desk screens, plus for admins a
// list of permissions switched off). The level checks everywhere stay exactly as they were. Owner-only edits, audited.

type Tx = Prisma.TransactionClient;

export type JobRoleRow = {
  id: string; label: string; accessLevel: JobRoleLevel; screens: string[]; capabilityLimits: string[];
  isStarter: boolean; archived: boolean; people: number;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

async function assertOwner(tx: Tx, ownerId: string) {
  try { await assertActiveTeamActor(tx, ownerId, ["OWNER"]); } catch { throw new JobRoleError("Only the owner can change job roles."); }
}

async function lockedRole(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "JobRole" WHERE "id" = ${id} FOR UPDATE`;
  const row = await tx.jobRole.findUnique({ where: { id } });
  if (!row) throw new JobRoleError("That job role no longer exists.");
  return row;
}

/** Every job role (archived ones only when asked), with how many active people have it. */
export async function listJobRoles(options: { includeArchived?: boolean } = {}): Promise<JobRoleRow[]> {
  const rows = await prisma.jobRole.findMany({
    where: options.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ accessLevel: "asc" }, { isStarter: "desc" }, { label: "asc" }, { id: "asc" }],
    take: 200,
  });
  if (rows.length === 0) return [];
  const counts = await prisma.user.groupBy({
    by: ["jobRoleId"], where: { jobRoleId: { in: rows.map((r) => r.id) }, archivedAt: null }, _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.jobRoleId, c._count._all]));
  return rows.map((r) => ({
    id: r.id, label: r.label, accessLevel: r.accessLevel as JobRoleLevel, screens: strings(r.screens), capabilityLimits: strings(r.capabilityLimits),
    isStarter: r.isStarter, archived: Boolean(r.archivedAt), people: byId.get(r.id) ?? 0,
  }));
}

/** The screens a person is limited to, or null when they have no job role (their access level alone decides). */
export async function screensForUser(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { jobRoleId: true, role: true } });
  if (!user?.jobRoleId) return null;
  const role = await prisma.jobRole.findUnique({ where: { id: user.jobRoleId }, select: { screens: true, accessLevel: true } });
  // A job role that is gone, or no longer matches the person's level, grants nothing: fail closed to the narrowest view.
  if (!role || role.accessLevel !== user.role) return [];
  return strings(role.screens);
}

/** Used by invitations and assignment: the role must exist, be active, and fit the access level. */
export async function assertJobRoleFits(tx: Tx, jobRoleId: string, level: string) {
  const role = await tx.jobRole.findUnique({ where: { id: jobRoleId } });
  if (!role || role.archivedAt) throw new JobRoleError("That job role is not available.");
  if (role.accessLevel !== level) throw new JobRoleError(`That job role is for ${role.accessLevel === "ADMIN" ? "Admins" : "Staff"}, not ${level === "ADMIN" ? "Admins" : "Staff"}.`);
  return role;
}

/** Admin permission limits that come with a job role: switched OFF, never switched on. */
export async function applyCapabilityLimits(tx: Tx, userId: string, limits: string[], byUserId: string) {
  for (const capability of limits) {
    if (!(CAPABILITY_KEYS as string[]).includes(capability)) continue;
    await tx.staffCapabilityOverride.upsert({
      where: { userId_capability: { userId, capability } },
      create: { userId, capability, allowed: false, updatedByUserId: byUserId },
      update: { allowed: false, updatedByUserId: byUserId },
    });
  }
}

export type SaveJobRoleInput = { id?: string | null; label: unknown; accessLevel: unknown; screens: unknown; capabilityLimits?: unknown };

/** Owner only. Creates or edits a job role. Changes apply to everyone who has it from their next page. */
export async function saveJobRole(ownerId: string, input: SaveJobRoleInput) {
  const clean = validateJobRole(input, CAPABILITY_KEYS);
  return prisma.$transaction(async (tx) => {
    await assertOwner(tx, ownerId);
    if (!input.id) {
      const dup = await tx.jobRole.findFirst({ where: { label: { equals: clean.label, mode: "insensitive" }, archivedAt: null }, select: { id: true } });
      if (dup) throw new JobRoleError("There is already a job role with that name.");
      const row = await tx.jobRole.create({ data: { label: clean.label, accessLevel: clean.accessLevel, screens: clean.screens, capabilityLimits: clean.capabilityLimits } });
      await tx.auditLog.create({ data: { userId: ownerId, action: "team.job_role.create", entityType: "JobRole", entityId: row.id, newValue: clean } });
      return { id: row.id };
    }
    const existing = await lockedRole(tx, input.id);
    if (existing.accessLevel !== clean.accessLevel) {
      const using = await tx.user.count({ where: { jobRoleId: existing.id, archivedAt: null } });
      if (using > 0) throw new JobRoleError("Move the people who have this job role to another one before changing its access level.");
    }
    const dup = await tx.jobRole.findFirst({ where: { label: { equals: clean.label, mode: "insensitive" }, archivedAt: null, id: { not: existing.id } }, select: { id: true } });
    if (dup) throw new JobRoleError("There is already a job role with that name.");
    await tx.jobRole.update({ where: { id: existing.id }, data: { label: clean.label, accessLevel: clean.accessLevel, screens: clean.screens, capabilityLimits: clean.capabilityLimits } });
    // Permissions this job role switches off apply to the people who already have it, at once (locked in a fixed order),
    // and they are signed out so the change shows right away. Switching one back on never restores a permission here.
    const members = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "jobRoleId" = ${existing.id} AND "archivedAt" IS NULL ORDER BY "id" FOR UPDATE`;
    for (const m of members) await applyCapabilityLimits(tx, m.id, clean.capabilityLimits, ownerId);
    if (members.length > 0) await tx.session.deleteMany({ where: { userId: { in: members.map((m) => m.id) } } });
    await tx.auditLog.create({
      data: {
        userId: ownerId, action: "team.job_role.update", entityType: "JobRole", entityId: existing.id,
        oldValue: { label: existing.label, accessLevel: existing.accessLevel, screens: strings(existing.screens), capabilityLimits: strings(existing.capabilityLimits) }, newValue: clean,
      },
    });
    return { id: existing.id };
  });
}

/** Owner only. A job role that people still have cannot be archived. */
export async function archiveJobRole(ownerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await assertOwner(tx, ownerId);
    const role = await lockedRole(tx, id);
    if (role.archivedAt) return;
    const using = await tx.user.count({ where: { jobRoleId: id, archivedAt: null } });
    if (using > 0) throw new JobRoleError(`${using} ${using === 1 ? "person has" : "people have"} this job role. Move them to another one first.`);
    const waiting = await tx.teamInvitation.count({ where: { jobRoleId: id, status: "INVITED" } });
    if (waiting > 0) throw new JobRoleError(`${waiting} ${waiting === 1 ? "invitation is" : "invitations are"} waiting with this job role. Cancel ${waiting === 1 ? "it" : "them"} or wait until ${waiting === 1 ? "it is" : "they are"} used first.`);
    await tx.jobRole.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.auditLog.create({ data: { userId: ownerId, action: "team.job_role.archive", entityType: "JobRole", entityId: id, oldValue: { label: role.label } } });
  });
}

export async function restoreJobRole(ownerId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await assertOwner(tx, ownerId);
    const role = await lockedRole(tx, id);
    if (!role.archivedAt) return;
    const dup = await tx.jobRole.findFirst({ where: { label: { equals: role.label, mode: "insensitive" }, archivedAt: null, id: { not: id } }, select: { id: true } });
    if (dup) throw new JobRoleError("There is already a job role with that name.");
    await tx.jobRole.update({ where: { id }, data: { archivedAt: null } });
    await tx.auditLog.create({ data: { userId: ownerId, action: "team.job_role.restore", entityType: "JobRole", entityId: id } });
  });
}

/** Owner only. "Restore recommended": put one of the four starting job roles back to its starting screens. */
export async function restoreStarterJobRole(ownerId: string, id: string) {
  const starter = STARTER_JOB_ROLES.find((s) => s.id === id);
  if (!starter) throw new JobRoleError("Only the four starting job roles can be restored to their starting screens.");
  await prisma.$transaction(async (tx) => {
    await assertOwner(tx, ownerId);
    const role = await lockedRole(tx, id);
    await tx.jobRole.update({
      where: { id },
      data: { label: starter.label, accessLevel: starter.accessLevel, screens: starter.screens, capabilityLimits: starter.capabilityLimits, archivedAt: null },
    });
    await tx.auditLog.create({
      data: {
        userId: ownerId, action: "team.job_role.restore_starter", entityType: "JobRole", entityId: id,
        oldValue: { label: role.label, screens: strings(role.screens) }, newValue: { label: starter.label, screens: starter.screens },
      },
    });
  });
}

/**
 * Owner only. Gives a staff member or admin a job role (or removes it). They are signed out so the change shows at once,
 * and it is recorded. An admin job role switches its listed admin permissions OFF; it never switches any on.
 */
export async function assignJobRole(ownerId: string, targetId: string, jobRoleId: string | null) {
  let label = "no job role (access level only)";
  await prisma.$transaction(async (tx) => {
    await assertOwner(tx, ownerId);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, archivedAt: true, jobRoleId: true } });
    if (!target || target.archivedAt) throw new JobRoleError("That person is not an active team member.");
    if (target.role !== "STAFF" && target.role !== "ADMIN") throw new JobRoleError("Job roles are for staff and admins. Owners always have everything.");
    if ((target.jobRoleId ?? null) === jobRoleId) return;
    let limits: string[] = [];
    if (jobRoleId) {
      const role = await assertJobRoleFits(tx, jobRoleId, target.role as Role);
      limits = strings(role.capabilityLimits);
      label = role.label;
    }
    await tx.user.update({ where: { id: targetId }, data: { jobRoleId } });
    if (limits.length > 0) await applyCapabilityLimits(tx, targetId, limits, ownerId);
    await tx.session.deleteMany({ where: { userId: targetId } });
    await tx.auditLog.create({
      data: { userId: ownerId, action: "team.job_role.assign", entityType: "User", entityId: targetId, oldValue: { jobRoleId: target.jobRoleId }, newValue: { jobRoleId } },
    });
  });
  return noticeWarning(targetId, "job_role_changed", { extra: label });
}
