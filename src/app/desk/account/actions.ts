"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  AccountError,
  finishPasswordChange,
  maskEmail,
  noticeWarning,
  recordAccountEvent,
  twoFactorRequiredFor,
  updateMyProfile,
} from "@/domains/account";
import { revokeOtherSessions } from "@/domains/security/sessions";

// ACC-1 server actions. Each one works only on the signed-in person, re-checks their password where the design says so,
// records the change and tells them by email. Nothing here takes a user id from the browser.

export type AccountActionResult =
  | { status: "success"; message: string; backupCodes?: string[]; /** Something the person should know even though the change went through. */ warning?: string }
  | { status: "error"; message: string };

const ok = (message: string, extra?: { backupCodes?: string[]; warning?: string }): AccountActionResult => ({ status: "success", message, ...extra });
const fail = (message: string): AccountActionResult => ({ status: "error", message });

function plainError(error: unknown, fallback: string): string {
  if (error instanceof AccountError) return error.message;
  if (error instanceof APIError) {
    const code = (error.body as { code?: string } | undefined)?.code ?? "";
    if (/INVALID_PASSWORD/.test(code)) return "That password isn't right.";
    if (/SESSION_NOT_FRESH/.test(code)) return "For safety, sign out and sign back in, then try again.";
    if (/PASSWORD_(TOO_SHORT|TOO_LONG)/.test(code)) return "Choose a password between 10 and 128 characters.";
  }
  return fallback;
}

async function currentPasswordIsRight(password: string): Promise<boolean> {
  if (!password) return false;
  try {
    await auth.api.verifyPassword({ headers: await headers(), body: { password } });
    return true;
  } catch {
    return false;
  }
}

export async function saveProfileAction(input: { name: string; phone: string }): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  try {
    const result = await updateMyProfile(session.user.id, { name: String(input.name ?? ""), phone: String(input.phone ?? "") });
    revalidatePath("/desk/account");
    if (!result.changed) return ok("Nothing was different, so nothing changed.");
    return ok(result.phoneChanged && String(input.phone ?? "").trim() !== ""
      ? "Saved. Your phone number is saved as not confirmed yet."
      : "Saved.", { warning: result.warning });
  } catch (error) {
    return fail(plainError(error, "Your details could not be saved."));
  }
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  signOutOthers: boolean;
}): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  const currentPassword = String(input.currentPassword ?? "");
  const newPassword = String(input.newPassword ?? "");
  if (newPassword.length < 10 || newPassword.length > 128) return fail("Choose a password between 10 and 128 characters.");
  if (newPassword === currentPassword) return fail("Choose a password that is different from your current one.");
  try {
    // The library checks the current password. Other sessions are ended below (not by the library) so this browser stays signed in.
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: false },
    });
  } catch (error) {
    return fail(plainError(error, "Your password could not be changed."));
  }
  const followUp = await finishPasswordChange(session.user.id, session.session.token, input.signOutOthers, revokeOtherSessions);
  revalidatePath("/desk/account");
  if (followUp.signOutFailed) {
    return ok("Password changed.", {
      warning: `Your other devices could NOT be signed out. Press "Sign out my other devices" below to try again.${followUp.warning ? ` ${followUp.warning}` : ""}`,
    });
  }
  return ok(
    followUp.signedOut > 0
      ? `Password changed. ${followUp.signedOut} other device${followUp.signedOut === 1 ? " was" : "s were"} signed out.`
      : "Password changed.",
    { warning: followUp.warning },
  );
}

export async function requestEmailChangeAction(input: { newEmail: string; currentPassword: string }): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  const newEmail = String(input.newEmail ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail) || newEmail.length > 200) return fail("Enter a full email address.");
  if (newEmail === session.user.email.toLowerCase()) return fail("That is already your sign-in email.");
  if (!(await currentPasswordIsRight(String(input.currentPassword ?? "")))) return fail("That password isn't right.");
  try {
    await auth.api.changeEmail({
      headers: await headers(),
      body: { newEmail, callbackURL: "/desk/account?email=confirmed" },
    });
  } catch (error) {
    return fail(plainError(error, "The email change could not be started."));
  }
  await recordAccountEvent(session.user.id, "account.email_change_requested", { newEmail, oldEmail: session.user.email });
  const warning = await noticeWarning(session.user.id, "email_requested", { extra: maskEmail(newEmail) });
  // Same answer whether or not the address can be used, so nobody can probe which addresses already have accounts.
  return ok(`If ${newEmail} can be used, a link was sent to it. Your sign-in email stays the same until you open that link.`, { warning });
}

export async function makeBackupCodesAction(input: { currentPassword: string }): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { twoFactorEnabled: true } });
  if (!user?.twoFactorEnabled) return fail("Set up two-step sign-in first.");
  try {
    const result = await auth.api.generateBackupCodes({
      headers: await headers(),
      body: { password: String(input.currentPassword ?? "") },
    });
    await recordAccountEvent(session.user.id, "account.backup_codes_regenerated");
    const warning = await noticeWarning(session.user.id, "backup_codes");
    return ok("New backup codes are below. Each works once, and the old ones no longer work. They are only shown now.", { backupCodes: result.backupCodes, warning });
  } catch (error) {
    return fail(plainError(error, "New backup codes could not be made."));
  }
}

export async function turnOffTwoStepAction(input: { currentPassword: string }): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  if (await twoFactorRequiredFor(session.user.role)) {
    return fail("Your role has to keep two-step sign-in on. The owner can change that in Settings.");
  }
  try {
    await auth.api.disableTwoFactor({ headers: await headers(), body: { password: String(input.currentPassword ?? "") } });
  } catch (error) {
    return fail(plainError(error, "Two-step sign-in could not be turned off."));
  }
  // The library starts a fresh session we cannot hand to the browser, so end every session and sign in again.
  await prisma.session.deleteMany({ where: { userId: session.user.id } });
  // ACC-6: turning two-step off forgets remembered devices, so the next sign-in asks for a code again.
  const { forgetTrustedDevices } = await import("@/domains/security/trusted-devices");
  await forgetTrustedDevices(session.user.id);
  await recordAccountEvent(session.user.id, "account.two_step_turned_off");
  // The person is sent to sign in again, so a failed notice cannot be shown on this page; noticeWarning records it.
  await noticeWarning(session.user.id, "two_step_off");
  redirect("/login");
}

export async function signOutOtherDevicesAction(): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  try {
    const count = await revokeOtherSessions(session.user.id, session.session.token);
    revalidatePath("/desk/account");
    return ok(count === 0 ? "No other devices were signed in." : `Signed out ${count} other device${count === 1 ? "" : "s"}.`);
  } catch {
    return fail("Other devices could not be signed out.");
  }
}

export async function forgetRememberedDevicesAction(): Promise<AccountActionResult> {
  const session = await requireRole("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  try {
    const { forgetTrustedDevices } = await import("@/domains/security/trusted-devices");
    // Re-check the actor inside the forget's transaction: if the person was deactivated after the role
    // check above but before this runs, the forget refuses instead of deleting their trust rows.
    await forgetTrustedDevices(session.user.id, { assertActor: true });
    revalidatePath("/desk/account");
    return ok("Remembered devices forgotten. You will be asked for a code next time on every device.");
  } catch {
    return fail("Remembered devices could not be forgotten.");
  }
}
