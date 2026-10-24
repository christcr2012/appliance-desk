import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { sendEmail } from "@/lib/email";
import { auth } from "@/lib/auth";
import { createTrustedCredentialUserInTx, normalizeAccountEmail } from "@/lib/account-provisioning";
import { CAPABILITY_KEYS, isCapability } from "@/domains/capabilities";
import { cleanName, normalizePhone, noticeWarning } from "@/domains/account";
import { applyCapabilityLimits, assertJobRoleFits, JobRoleError } from "./job-roles";
import {
  ACCESS_LEVEL_LABEL, INVALID_LINK_MESSAGE, INVITATION_LINK_DAYS_DEFAULT, TeamError, assertMayInvite,
  assertMayRemoveOrRestore, clampLinkDays, effectiveInvitationState, hashInvitationCode, invitationExpiry,
  newInvitationCode, parseInvitableLevel, validateNewPassword, type InvitableLevel,
} from "./rules";
export { TeamError } from "./rules";

// ACC-2: team invitations, the Team list, access levels, remove/restore. Every write locks the rows it changes and
// re-checks the acting person inside the same transaction.

type Tx = Prisma.TransactionClient;

async function readSettings(tx: Tx | typeof prisma) {
  const row = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { invitationLinkDays: true, adminsMayInviteStaff: true } });
  return { invitationLinkDays: row?.invitationLinkDays ?? INVITATION_LINK_DAYS_DEFAULT, adminsMayInviteStaff: row?.adminsMayInviteStaff ?? false };
}

export async function getTeamSettings() {
  return readSettings(prisma);
}

/** Owner only. */
export async function updateTeamSettings(ownerId: string, input: { invitationLinkDays: number; adminsMayInviteStaff: boolean }) {
  const days = clampLinkDays(input.invitationLinkDays);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    const before = await readSettings(tx);
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", invitationLinkDays: days, adminsMayInviteStaff: input.adminsMayInviteStaff },
      update: { invitationLinkDays: days, adminsMayInviteStaff: input.adminsMayInviteStaff },
    });
    await tx.auditLog.create({
      data: { userId: ownerId, action: "team.settings", entityType: "BusinessSettings", entityId: "singleton", oldValue: before, newValue: { invitationLinkDays: days, adminsMayInviteStaff: input.adminsMayInviteStaff } },
    });
  });
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type InviteEmailOutcome = "SENT" | "NOT_SENT";

async function sendInvitationEmail(input: { to: string; name: string; level: string; code: string; inviterName: string; days: number; purpose?: string }): Promise<InviteEmailOutcome> {
  try {
    const link = `${appUrl()}/join/${input.code}`;
    const reset = input.purpose === "RESET";
    const result = await sendEmail({
      to: input.to,
      subject: reset ? "Choose a new password for Appliance Desk" : "You are invited to join Robinson Appliance Rentals on Appliance Desk",
      text: reset ? [
        `Hello ${input.name},`,
        `${input.inviterName} reset your sign-in. Open this link to choose a new password; you will set up your second sign-in step again afterwards: ${link}`,
        `The link works once and stops working after ${input.days} day${input.days === 1 ? "" : "s"}. If you were not expecting this, tell the owner.`,
      ].join("\n\n") : [
        `Hello ${input.name},`,
        `${input.inviterName} invited you to join the team as ${ACCESS_LEVEL_LABEL[input.level] ?? "Staff"}.`,
        `Open this link to choose your password and finish setting up your account: ${link}`,
        `The link works once and stops working after ${input.days} day${input.days === 1 ? "" : "s"}. If you were not expecting this, ignore this email.`,
      ].join("\n\n"),
    });
    return result.sent ? "SENT" : "NOT_SENT";
  } catch {
    return "NOT_SENT";
  }
}

function parseLimits(level: InvitableLevel, raw: unknown): string[] {
  if (level !== "ADMIN") return [];
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !isCapability(item)) throw new TeamError("That permission does not exist.");
    out.add(item);
  }
  return [...out];
}

export type InviteInput = { name: string; email: string; phone?: string | null; accessLevel: string; adminCapabilityLimits?: unknown; jobRoleId?: string | null };

async function inviterLabel(tx: Tx, id: string) {
  const u = await tx.user.findUnique({ where: { id }, select: { name: true, email: true } });
  return u?.name || u?.email || "The owner";
}

async function lockEmail(tx: Tx, email: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"team-invite:" + email}))::text`;
}

async function assertEmailFree(tx: Tx, email: string, exceptInvitationId?: string) {
  const user = await tx.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (user) {
    throw new TeamError(user.role === "CUSTOMER" ? "That email already belongs to a customer account. Use a different email for the team member." : "That email already belongs to someone on the team.");
  }
  const open = await tx.teamInvitation.findFirst({
    where: { email, status: "INVITED", expiresAt: { gt: new Date() }, ...(exceptInvitationId ? { id: { not: exceptInvitationId } } : {}) },
    select: { id: true },
  });
  if (open) throw new TeamError("That email already has an open invitation. Resend or cancel it instead.");
}

export async function inviteTeamMember(actorId: string, input: InviteInput) {
  const name = cleanName(input.name);
  if (!name) throw new TeamError("Enter the person's name.");
  const email = normalizeAccountEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TeamError("Enter a valid email address.");
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const level = parseInvitableLevel(input.accessLevel);
  const limits = parseLimits(level, input.adminCapabilityLimits);
  const code = newInvitationCode();

  const created = await prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const settings = await readSettings(tx);
    assertMayInvite(actor.role, level, settings.adminsMayInviteStaff);
    await lockEmail(tx, email);
    await assertEmailFree(tx, email);
    const jobRoleId = input.jobRoleId || null;
    if (jobRoleId) {
      try { await assertJobRoleFits(tx, jobRoleId, level); } catch (e) { throw e instanceof JobRoleError ? new TeamError(e.message) : e; }
    }
    const inv = await tx.teamInvitation.create({
      data: {
        email, name, phone, accessLevel: level, adminCapabilityLimits: limits, jobRoleId, codeHash: hashInvitationCode(code),
        expiresAt: invitationExpiry(new Date(), settings.invitationLinkDays), invitedById: actorId,
      },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "team.invite.create", entityType: "TeamInvitation", entityId: inv.id, newValue: { email, accessLevel: level, limits, jobRoleId } },
    });
    return { inv, inviter: await inviterLabel(tx, actorId), days: settings.invitationLinkDays };
  });

  const emailOutcome = await sendInvitationEmail({ to: email, name, level, code, inviterName: created.inviter, days: created.days });
  return { invitationId: created.inv.id, emailOutcome };
}

async function lockedInvitation(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "TeamInvitation" WHERE "id" = ${id} FOR UPDATE`;
  const inv = await tx.teamInvitation.findUnique({ where: { id } });
  if (!inv) throw new TeamError("That invitation no longer exists.");
  return inv;
}

async function assertMayManage(tx: Tx, actorId: string, level: string) {
  const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
  const settings = await readSettings(tx);
  assertMayInvite(actor.role, parseInvitableLevel(level), settings.adminsMayInviteStaff);
  return { actor, settings };
}

async function assertOwnerManage(tx: Tx, actorId: string) {
  const actor = await assertActiveTeamActor(tx, actorId, ["OWNER"]);
  return { actor, settings: await readSettings(tx) };
}

/** A new link; the old one stops working at once. Allowed while Invited or Expired. */
export async function resendInvitation(actorId: string, invitationId: string) {
  const code = newInvitationCode();
  const out = await prisma.$transaction(async (tx) => {
    const inv = await lockedInvitation(tx, invitationId);
    const { settings } = inv.purpose === "RESET" ? await assertOwnerManage(tx, actorId) : await assertMayManage(tx, actorId, inv.accessLevel);
    if (inv.status !== "INVITED") throw new TeamError("Only an invitation that has not been used or cancelled can be sent again.");
    if (inv.purpose !== "RESET") {
      await lockEmail(tx, inv.email);
      await assertEmailFree(tx, inv.email, inv.id);
    }
    await tx.teamInvitation.update({ where: { id: inv.id }, data: { codeHash: hashInvitationCode(code), expiresAt: invitationExpiry(new Date(), settings.invitationLinkDays), invitedById: actorId } });
    // The person sending it now vouches for the new link (the earlier sender may have been removed); the audit row keeps both.
    await tx.auditLog.create({ data: { userId: actorId, action: "team.invite.resend", entityType: "TeamInvitation", entityId: inv.id, oldValue: { invitedById: inv.invitedById }, newValue: { invitedById: actorId } } });
    return { inv, inviter: await inviterLabel(tx, actorId), days: settings.invitationLinkDays };
  });
  const emailOutcome = await sendInvitationEmail({ to: out.inv.email, name: out.inv.name, level: out.inv.accessLevel, code, inviterName: out.inviter, days: out.days, purpose: out.inv.purpose });
  return { emailOutcome };
}

export async function cancelInvitation(actorId: string, invitationId: string) {
  await prisma.$transaction(async (tx) => {
    const inv = await lockedInvitation(tx, invitationId);
    if (inv.purpose === "RESET") await assertOwnerManage(tx, actorId);
    else await assertMayManage(tx, actorId, inv.accessLevel);
    if (inv.status !== "INVITED") throw new TeamError("Only an invitation that has not been used can be cancelled.");
    await tx.teamInvitation.update({ where: { id: inv.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await tx.auditLog.create({ data: { userId: actorId, action: "team.invite.cancel", entityType: "TeamInvitation", entityId: inv.id } });
  });
}

export type JoinView = { ok: true; name: string; email: string; accessLevel: string; reset: boolean } | { ok: false; message: string };

/** What the /join page shows. Reveals nothing for a code that does not work. */
export async function getJoinView(code: string): Promise<JoinView> {
  if (!code || code.length > 200) return { ok: false, message: INVALID_LINK_MESSAGE };
  const inv = await prisma.teamInvitation.findUnique({ where: { codeHash: hashInvitationCode(code) } });
  if (!inv || effectiveInvitationState(inv.status, inv.expiresAt, new Date()) !== "INVITED") return { ok: false, message: INVALID_LINK_MESSAGE };
  return { ok: true, name: inv.name, email: inv.email, accessLevel: ACCESS_LEVEL_LABEL[inv.accessLevel] ?? "Staff", reset: inv.purpose === "RESET" };
}

/**
 * The person chose a password. In ONE transaction: lock the invitation, re-check it, create the login (and an
 * admin's limits), mark it used. Two people (or two clicks) racing on one link create exactly one account.
 */
export async function acceptInvitation(code: string, password: string, confirm: string) {
  validateNewPassword(password, confirm);
  if (!code || code.length > 200) throw new TeamError(INVALID_LINK_MESSAGE);
  const hash = hashInvitationCode(code);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TeamInvitation" WHERE "codeHash" = ${hash} FOR UPDATE`;
    if (locked.length === 0) throw new TeamError(INVALID_LINK_MESSAGE);
    const inv = await tx.teamInvitation.findUniqueOrThrow({ where: { id: locked[0].id } });
    if (effectiveInvitationState(inv.status, inv.expiresAt, new Date()) !== "INVITED") throw new TeamError(INVALID_LINK_MESSAGE);
    if (inv.purpose === "RESET") return finishReset(tx, inv, password);
    await lockEmail(tx, inv.email);
    if (await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } })) throw new TeamError(INVALID_LINK_MESSAGE);
    // The inviter must still be an active owner/admin when the link is used (a removed inviter's links stop working).
    // Checked under a shared lock on their account row, so removing or demoting them cannot slip in between this
    // check and the account being created.
    try { await assertActiveTeamActor(tx, inv.invitedById, ["OWNER", "ADMIN"]); } catch { throw new TeamError(INVALID_LINK_MESSAGE); }

    // The job role chosen at invitation time must still be available and fit. Otherwise the link is refused rather than
    // quietly giving the person more than the owner meant; the owner sends a fresh invitation.
    let jobRole: Awaited<ReturnType<typeof tx.jobRole.findUnique>> = null;
    if (inv.jobRoleId) {
      jobRole = await tx.jobRole.findUnique({ where: { id: inv.jobRoleId } });
      if (!jobRole || jobRole.archivedAt || jobRole.accessLevel !== inv.accessLevel) throw new TeamError("The job role for this invitation is no longer available. Ask the owner to send you a new invitation.");
    }
    const user = await createTrustedCredentialUserInTx(tx, { email: inv.email, name: inv.name, role: inv.accessLevel, password, emailVerified: true });
    if (inv.phone) await tx.user.update({ where: { id: user.id }, data: { phone: inv.phone } });
    if (inv.accessLevel === "ADMIN") {
      const limits = (Array.isArray(inv.adminCapabilityLimits) ? inv.adminCapabilityLimits : []).filter((c): c is string => typeof c === "string" && isCapability(c));
      for (const capability of limits) {
        await tx.staffCapabilityOverride.create({ data: { userId: user.id, capability, allowed: false, updatedByUserId: inv.invitedById } });
      }
    }
    // The job role chosen at invitation time (if it is still available and still fits). It only narrows.
    if (jobRole) {
      await tx.user.update({ where: { id: user.id }, data: { jobRoleId: jobRole.id } });
      const roleLimits = (Array.isArray(jobRole.capabilityLimits) ? jobRole.capabilityLimits : []).filter((c): c is string => typeof c === "string");
      await applyCapabilityLimits(tx, user.id, roleLimits, inv.invitedById);
    }
    await tx.teamInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedUserId: user.id, acceptedAt: new Date() } });
    await tx.auditLog.create({
      data: { userId: user.id, action: "team.invite.accept", entityType: "TeamInvitation", entityId: inv.id, newValue: { userId: user.id, accessLevel: inv.accessLevel } },
    });
    return { email: user.email };
  });
}

export type TeamMemberRow = {
  id: string; name: string; email: string; accessLevel: string; active: boolean; twoStepOn: boolean; lastSignIn: Date | null; jobRoleId: string | null;
};
export type TeamInvitationRow = { id: string; name: string; email: string; accessLevel: string; state: string; expiresAt: Date; limits: string[] };

/** The Team list. Never includes codes, hashes, passwords or tokens. */
export async function getTeam(): Promise<{ members: TeamMemberRow[]; invitations: TeamInvitationRow[] }> {
  const users = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "STAFF"] } },
    select: { id: true, name: true, email: true, role: true, archivedAt: true, twoFactorEnabled: true, jobRoleId: true, sessions: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
  });
  const order: Record<string, number> = { OWNER: 0, ADMIN: 1, STAFF: 2 };
  const members = users
    .map((u) => ({ id: u.id, name: u.name || u.email, email: u.email, accessLevel: u.role as string, active: !u.archivedAt, twoStepOn: u.twoFactorEnabled, lastSignIn: u.sessions[0]?.createdAt ?? null, jobRoleId: u.jobRoleId }))
    .sort((a, b) => order[a.accessLevel] - order[b.accessLevel]);
  const rows = await prisma.teamInvitation.findMany({ where: { purpose: "INVITE", status: { in: ["INVITED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 200 });
  const now = new Date();
  const invitations = rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, accessLevel: r.accessLevel as string, state: effectiveInvitationState(r.status, r.expiresAt, now), expiresAt: r.expiresAt,
    limits: (Array.isArray(r.adminCapabilityLimits) ? r.adminCapabilityLimits : []).filter((c): c is string => typeof c === "string"),
  }));
  return { members, invitations };
}

/** Number of active owners (used by the last-owner guard). */
async function activeOwnerCount(tx: Tx) {
  return tx.user.count({ where: { role: "OWNER", archivedAt: null } });
}

export async function removeTeamMember(actorId: string, targetId: string) {
  await prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, archivedAt: true } });
    if (!target) throw new TeamError("That account no longer exists.");
    assertMayRemoveOrRestore(actor.role, actorId, target.role, target.id);
    if (target.archivedAt) throw new TeamError("That person is already removed.");
    if (target.role === "OWNER" && (await activeOwnerCount(tx)) <= 1) throw new TeamError("The last owner cannot be removed.");
    await tx.user.update({ where: { id: targetId }, data: { archivedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: targetId } });
    await tx.auditLog.create({ data: { userId: actorId, action: "team.remove", entityType: "User", entityId: targetId, oldValue: { role: target.role } } });
  });
  return noticeWarning(targetId, "team_removed");
}

export async function restoreTeamMember(actorId: string, targetId: string) {
  await prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, archivedAt: true } });
    if (!target) throw new TeamError("That account no longer exists.");
    assertMayRemoveOrRestore(actor.role, actorId, target.role, target.id);
    if (!target.archivedAt) throw new TeamError("That person is not removed.");
    await tx.user.update({ where: { id: targetId }, data: { archivedAt: null } });
    await tx.auditLog.create({ data: { userId: actorId, action: "team.restore", entityType: "User", entityId: targetId, newValue: { role: target.role } } });
  });
  return noticeWarning(targetId, "team_restored");
}

/**
 * Owner only: Staff <-> Admin. Signs the person out everywhere so the new level takes effect at once. Promoting
 * starts every admin permission OFF except the ones the owner ticked; demoting clears admin limits.
 */
export async function changeAccessLevel(ownerId: string, targetId: string, newLevel: string, allowedCapabilities: unknown = []) {
  const level = parseInvitableLevel(newLevel);
  const ticked = new Set<string>();
  if (Array.isArray(allowedCapabilities)) for (const c of allowedCapabilities) {
    if (typeof c !== "string" || !isCapability(c)) throw new TeamError("That permission does not exist.");
    ticked.add(c);
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, archivedAt: true } });
    if (!target) throw new TeamError("That account no longer exists.");
    if (target.id === ownerId) throw new TeamError("You cannot change your own access level.");
    if (target.role === "OWNER") {
      if ((await activeOwnerCount(tx)) <= 1) throw new TeamError("The last owner cannot be changed.");
      throw new TeamError("An owner's access level cannot be changed here.");
    }
    if (target.role !== "STAFF" && target.role !== "ADMIN") throw new TeamError("That account is not a team login.");
    if (target.archivedAt) throw new TeamError("Restore this person before changing their access level.");
    if (target.role === level) throw new TeamError(`That person is already ${ACCESS_LEVEL_LABEL[level]}.`);
    await tx.user.update({ where: { id: targetId }, data: { role: level as Role, jobRoleId: null } });
    await tx.staffCapabilityOverride.deleteMany({ where: { userId: targetId } });
    if (level === "ADMIN") {
      for (const capability of CAPABILITY_KEYS.filter((c) => !ticked.has(c))) {
        await tx.staffCapabilityOverride.create({ data: { userId: targetId, capability, allowed: false, updatedByUserId: ownerId } });
      }
    }
    await tx.session.deleteMany({ where: { userId: targetId } });
    await tx.auditLog.create({
      data: { userId: ownerId, action: "team.role_change", entityType: "User", entityId: targetId, oldValue: { role: target.role }, newValue: { role: level, allowed: level === "ADMIN" ? [...ticked] : [] } },
    });
  });
  return noticeWarning(targetId, "access_changed", { extra: ACCESS_LEVEL_LABEL[level] });
}

type InvitationRow = Awaited<ReturnType<Tx["teamInvitation"]["findUniqueOrThrow"]>>;

/** Finishing an owner's reset: choose a new password on the existing login. Two-step was already turned off by the reset. */
async function finishReset(tx: Tx, inv: InvitationRow, password: string) {
  const targetId = inv.targetUserId;
  if (!targetId) throw new TeamError(INVALID_LINK_MESSAGE);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
  const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, role: true, archivedAt: true } });
  if (!target || target.archivedAt || target.email !== inv.email || (target.role !== "STAFF" && target.role !== "ADMIN")) throw new TeamError(INVALID_LINK_MESSAGE);
  // The owner who made the link must still be an active owner, checked under a shared lock on their row.
  try { await assertActiveTeamActor(tx, inv.invitedById, ["OWNER"]); } catch { throw new TeamError(INVALID_LINK_MESSAGE); }
  const hash = await (await auth.$context).password.hash(password);
  const credential = await tx.account.findFirst({ where: { userId: targetId, providerId: "credential" }, select: { id: true } });
  if (credential) await tx.account.update({ where: { id: credential.id }, data: { password: hash } });
  else await tx.account.create({ data: { userId: targetId, providerId: "credential", accountId: targetId, password: hash } });
  await tx.session.deleteMany({ where: { userId: targetId } });
  await tx.user.update({ where: { id: targetId }, data: { failedSignInCount: 0, failedSignInWindowStartedAt: null, signInPausedUntil: null } });
  await tx.teamInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedUserId: targetId, acceptedAt: new Date() } });
  await tx.auditLog.create({ data: { userId: targetId, action: "team.reset_sign_in.complete", entityType: "TeamInvitation", entityId: inv.id } });
  return { email: target.email };
}

/**
 * Owner only, for staff and admins (never the owner's own account, never an owner). Turns off their second step,
 * signs them out everywhere and sends a fresh link to choose a new password. Any earlier open reset link stops working.
 */
export async function resetTeamSignIn(ownerId: string, targetId: string) {
  const code = newInvitationCode();
  const out = await prisma.$transaction(async (tx) => {
    const { settings } = await assertOwnerManage(tx, ownerId);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, email: true, name: true, role: true, archivedAt: true, twoFactorEnabled: true } });
    if (!target) throw new TeamError("That account no longer exists.");
    if (target.id === ownerId) throw new TeamError("You cannot reset your own sign-in this way. Use My account, or the recovery steps.");
    if (target.role !== "STAFF" && target.role !== "ADMIN") throw new TeamError("Only staff and admin sign-ins can be reset here.");
    if (target.archivedAt) throw new TeamError("Restore this person before resetting their sign-in.");
    await tx.teamInvitation.updateMany({ where: { purpose: "RESET", targetUserId: targetId, status: "INVITED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await tx.twoFactor.deleteMany({ where: { userId: targetId } });
    await tx.user.update({ where: { id: targetId }, data: { twoFactorEnabled: false, secondStepMethod: null, failedSignInCount: 0, failedSignInWindowStartedAt: null, signInPausedUntil: null } });
    await tx.session.deleteMany({ where: { userId: targetId } });
    // The old password stops working right now (it is swapped for a random one nobody knows), so nobody who holds it can
    // walk in with password alone while the reset link is waiting. Choosing a new password through the link, or
    // "Forgot password", sets a real one.
    const unusable = await (await auth.$context).password.hash(newInvitationCode() + newInvitationCode());
    await tx.account.updateMany({ where: { userId: targetId, providerId: "credential" }, data: { password: unusable } });
    const inv = await tx.teamInvitation.create({
      data: {
        email: target.email, name: target.name || target.email, accessLevel: target.role, purpose: "RESET", targetUserId: targetId,
        codeHash: hashInvitationCode(code), expiresAt: invitationExpiry(new Date(), settings.invitationLinkDays), invitedById: ownerId,
      },
    });
    await tx.auditLog.create({
      data: { userId: ownerId, action: "team.reset_sign_in", entityType: "User", entityId: targetId, oldValue: { twoFactorEnabled: target.twoFactorEnabled }, newValue: { invitationId: inv.id } },
    });
    return { target, inviter: await inviterLabel(tx, ownerId), days: settings.invitationLinkDays };
  });
  const emailOutcome = await sendInvitationEmail({ to: out.target.email, name: out.target.name || out.target.email, level: out.target.role, code, inviterName: out.inviter, days: out.days, purpose: "RESET" });
  const warning = await noticeWarning(targetId, "sign_in_reset");
  return { emailOutcome, warning };
}
