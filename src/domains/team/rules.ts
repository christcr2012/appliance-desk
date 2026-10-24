import { createHash, randomBytes } from "node:crypto";

// ACC-2: pure rules for team invitations (no database). The database work is in ./index.ts.

export class TeamError extends Error {}

export const INVITATION_LINK_DAYS_DEFAULT = 7;
export const INVITATION_LINK_DAYS_MIN = 1;
export const INVITATION_LINK_DAYS_MAX = 30;
export const MIN_PASSWORD_LENGTH = 10; // must match src/lib/auth.ts emailAndPassword.minPasswordLength

export type InvitableLevel = "STAFF" | "ADMIN";
export type InvitationState = "INVITED" | "EXPIRED" | "CANCELLED" | "ACCEPTED";

export const INVALID_LINK_MESSAGE = "This link no longer works. Ask the owner for a new one.";

/** A long random code for the emailed link. Only its hash is ever stored. */
export function newInvitationCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function clampLinkDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < INVITATION_LINK_DAYS_MIN || n > INVITATION_LINK_DAYS_MAX) {
    throw new TeamError(`Invitation links must last between ${INVITATION_LINK_DAYS_MIN} and ${INVITATION_LINK_DAYS_MAX} days.`);
  }
  return n;
}

export function invitationExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** What the Team list shows: a stored INVITED row past its expiry is shown (and treated) as Expired. */
export function effectiveInvitationState(status: string, expiresAt: Date, now: Date): InvitationState {
  if (status === "ACCEPTED" || status === "CANCELLED") return status;
  return expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "INVITED";
}

export function parseInvitableLevel(value: unknown): InvitableLevel {
  if (value === "STAFF" || value === "ADMIN") return value;
  throw new TeamError("Choose Staff or Admin.");
}

/** Who may invite whom. Owners: either level. Admins: staff only, and only if the owner turned that on. */
export function assertMayInvite(actorRole: string, level: InvitableLevel, adminsMayInviteStaff: boolean): void {
  if (actorRole === "OWNER") return;
  if (actorRole === "ADMIN") {
    if (level !== "STAFF") throw new TeamError("Only the owner can invite an admin.");
    if (!adminsMayInviteStaff) throw new TeamError("The owner has not allowed admins to invite staff. Ask the owner.");
    return;
  }
  throw new TeamError("This account no longer has access to make that change.");
}

/** Remove / restore: owner may act on staff and admins; an admin only on staff. Nobody on themselves; never an owner. */
export function assertMayRemoveOrRestore(actorRole: string, actorId: string, targetRole: string, targetId: string): void {
  if (actorId === targetId) throw new TeamError("You cannot remove or restore your own account.");
  if (targetRole === "OWNER") throw new TeamError("The owner account cannot be removed.");
  if (targetRole !== "STAFF" && targetRole !== "ADMIN") throw new TeamError("That account is not a team login.");
  if (actorRole === "OWNER") return;
  if (actorRole === "ADMIN" && targetRole === "STAFF") return;
  throw new TeamError("Only the owner can remove or restore an admin.");
}

export function validateNewPassword(password: string, confirm: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new TeamError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password !== confirm) throw new TeamError("Those passwords don't match.");
}

export const ACCESS_LEVEL_LABEL: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff" };
