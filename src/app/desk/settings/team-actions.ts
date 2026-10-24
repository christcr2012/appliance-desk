"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  TeamError, cancelInvitation, changeAccessLevel, inviteTeamMember, removeTeamMember, resendInvitation,
  resetTeamSignIn, restoreTeamMember, updateTeamSettings,
} from "@/domains/team";

// ACC-2 Team actions. The rules (who may do what) are enforced in src/domains/team, inside the transaction; the role
// check here is the coarse front door only.

export type TeamActionState = { status: "success"; message: string; warning?: string } | { status: "error"; message: string };

const NOT_SENT = "The invitation was saved but the email was not sent. Use Send again on that row to retry; do not invite them twice.";

async function run(fn: () => Promise<{ message: string; warning?: string }>, fallback: string): Promise<TeamActionState> {
  try {
    const out = await fn();
    revalidatePath("/desk/settings");
    revalidatePath("/desk/activity");
    return { status: "success", ...out };
  } catch (error) {
    return { status: "error", message: error instanceof TeamError ? error.message : error instanceof Error && error.message.startsWith("This account no longer") ? error.message : fallback };
  }
}

export async function inviteTeamMemberAction(raw: { name: string; email: string; phone?: string; accessLevel: string; adminCapabilityLimits?: string[] }): Promise<TeamActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  return run(async () => {
    const r = await inviteTeamMember(session.user.id, raw);
    return r.emailOutcome === "SENT" ? { message: `Invitation emailed to ${raw.email.trim()}. The link works once.` } : { message: "Invitation saved.", warning: NOT_SENT };
  }, "Couldn't create that invitation.");
}

export async function resendInvitationAction(invitationId: string): Promise<TeamActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  return run(async () => {
    const r = await resendInvitation(session.user.id, invitationId);
    return r.emailOutcome === "SENT" ? { message: "A new link was emailed. The old link no longer works." } : { message: "A new link was made and the old one stopped working.", warning: "The email was not sent. Use Send again to retry." };
  }, "Couldn't send that invitation again.");
}

export async function cancelInvitationAction(invitationId: string): Promise<TeamActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  return run(async () => { await cancelInvitation(session.user.id, invitationId); return { message: "Invitation cancelled. The link no longer works." }; }, "Couldn't cancel that invitation.");
}

export async function removeTeamMemberAction(userId: string): Promise<TeamActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  return run(async () => { const warning = await removeTeamMember(session.user.id, userId); return { message: "Access removed and signed out everywhere.", warning }; }, "Couldn't remove that person's access.");
}

export async function restoreTeamMemberAction(userId: string): Promise<TeamActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  return run(async () => { const warning = await restoreTeamMember(session.user.id, userId); return { message: "Access restored.", warning }; }, "Couldn't restore that person.");
}

export async function changeAccessLevelAction(userId: string, level: string, allowedCapabilities: string[]): Promise<TeamActionState> {
  const session = await requireRole("OWNER");
  return run(async () => { const warning = await changeAccessLevel(session.user.id, userId, level, allowedCapabilities); return { message: "Access level changed. They were signed out and must sign in again.", warning }; }, "Couldn't change that access level.");
}

export async function saveTeamSettingsAction(input: { invitationLinkDays: number; adminsMayInviteStaff: boolean }): Promise<TeamActionState> {
  const session = await requireRole("OWNER");
  return run(async () => { await updateTeamSettings(session.user.id, input); return { message: "Saved." }; }, "Couldn't save those settings.");
}

export async function resetTeamSignInAction(userId: string): Promise<TeamActionState> {
  const session = await requireRole("OWNER");
  return run(async () => {
    const r = await resetTeamSignIn(session.user.id, userId);
    const sent = r.emailOutcome === "SENT";
    return {
      message: sent ? "Sign-in reset. They were signed out everywhere and emailed a link to choose a new password." : "Sign-in reset and they were signed out everywhere.",
      warning: sent ? r.warning : "The email with the link was not sent. Use Reset sign-in again to send a fresh link." + (r.warning ? ` ${r.warning}` : ""),
    };
  }, "Couldn't reset that sign-in.");
}
