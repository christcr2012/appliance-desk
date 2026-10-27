import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { sendEmail } from "@/lib/email";
import { sendCustomerEmail } from "@/lib/customer-email";
import { AccountError, cleanName, maskEmail, normalizePhone } from "./rules";
export { AccountError, cleanName, maskEmail, normalizePhone } from "./rules";
import { roleRequiresTwoFactor, RECOMMENDED_TWO_FACTOR_ROLES } from "@/domains/security/two-factor";

// ACC-1: "My account" for everyone on the desk. Every function here works only on the signed-in person's own row.

export type MyAccount = {
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  phone: string | null;
  phoneConfirmed: boolean;
  twoFactorEnabled: boolean;
  /** True when this person's role must keep two-step sign-in on (the owner can change that in settings). */
  twoFactorRequired: boolean;
};

const phoneEnding = (phone: string | null) => (phone ? phone.slice(-4) : null);

export async function twoFactorRequiredFor(role: string): Promise<boolean> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { twoFactorRequiredRoles: true },
  });
  return roleRequiresTwoFactor(role, settings?.twoFactorRequiredRoles ?? RECOMMENDED_TWO_FACTOR_ROLES);
}

export async function getMyAccount(userId: string): Promise<MyAccount> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, role: true, phone: true, phoneConfirmedAt: true, twoFactorEnabled: true, archivedAt: true },
  });
  if (!user || user.archivedAt || (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "STAFF")) {
    throw new AccountError("This account no longer has access.");
  }
  return {
    name: user.name ?? "",
    email: user.email,
    role: user.role,
    phone: user.phone,
    phoneConfirmed: user.phone !== null && user.phoneConfirmedAt !== null,
    twoFactorEnabled: user.twoFactorEnabled === true,
    twoFactorRequired: await twoFactorRequiredFor(user.role),
  };
}

export type ProfileResult = { changed: boolean; nameChanged: boolean; phoneChanged: boolean; /** Set when the notice email could not be confirmed sent. */ warning?: string };

/** Name and phone. A new phone number starts as "not confirmed yet" (the code check arrives with ACC-3). */
export async function updateMyProfile(userId: string, input: { name: string; phone: string }): Promise<ProfileResult> {
  const name = cleanName(input.name);
  const phone = normalizePhone(input.phone);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    await assertActiveTeamActor(tx, userId);
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, phone: true } });
    const nameChanged = (before.name ?? "") !== name;
    const phoneChanged = before.phone !== phone;
    if (!nameChanged && !phoneChanged) return { changed: false, nameChanged, phoneChanged };
    await tx.user.update({
      where: { id: userId },
      data: { name, phone, ...(phoneChanged ? { phoneConfirmedAt: null } : {}) },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "account.profile_update",
        entityType: "User",
        entityId: userId,
        oldValue: { name: before.name, phoneEnding: phoneEnding(before.phone) },
        newValue: { name, phoneEnding: phoneEnding(phone) },
      },
    });
    return { changed: true, nameChanged, phoneChanged };
  });
  if (!result.changed) return result;
  const warning = await noticeWarning(userId, "profile");
  return warning ? { ...result, warning } : result;
}

export type AccountEvent =
  | "account.password_changed"
  | "account.password_reset"
  | "account.email_change_requested"
  | "account.email_changed"
  | "account.backup_codes_regenerated"
  | "account.two_step_turned_off"
  | "account.notice_not_sent";

/** One audit row for a change made through the sign-in library. Never contains passwords, codes or links. */
export async function recordAccountEvent(userId: string, action: AccountEvent, detail?: Record<string, string | number | boolean | null>) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: "User", entityId: userId, ...(detail ? { newValue: detail } : {}) },
  });
}

export type AccountNoticeKind = "profile" | "password" | "email_requested" | "email_changed" | "backup_codes" | "two_step_off" | "access_changed" | "team_removed" | "team_restored"
  | "sign_in_paused" | "new_device" | "sign_in_reset" | "two_step_changed" | "job_role_changed";

const NOTICE_TEXT: Record<AccountNoticeKind, { subject: string; line: (extra?: string) => string }> = {
  profile: { subject: "Your account details were changed", line: () => "Your name or phone number on Appliance Desk was just changed." },
  password: { subject: "Your password was changed", line: () => "The password for your Appliance Desk account was just changed." },
  email_requested: {
    subject: "A change to your sign-in email was requested",
    line: (extra) => `Someone asked to change the sign-in email on your Appliance Desk account to ${extra ?? "a new address"}. Nothing changes until the link sent to that new address is used.`,
  },
  email_changed: {
    subject: "Your sign-in email was changed",
    line: (extra) => `The sign-in email on your Appliance Desk account was changed to ${extra ?? "a new address"}.`,
  },
  backup_codes: { subject: "New backup codes were made", line: () => "New two-step backup codes were made for your account. The old ones no longer work." },
  access_changed: { subject: "Your access level was changed", line: (extra) => `Your access level on Appliance Desk was changed${extra ? ` to ${extra}` : ""}. You were signed out; sign in again to continue.` },
  team_removed: { subject: "Your access was removed", line: () => "Your access to Appliance Desk was removed by the owner." },
  team_restored: { subject: "Your access was restored", line: () => "Your access to Appliance Desk was restored. Sign in with your usual email and password." },
  sign_in_paused: { subject: "Sign-in was paused after wrong passwords", line: () => "Several wrong passwords were tried on your Appliance Desk account, so sign-in is paused for a short while. If that was you, wait and try again or use Forgot password." },
  new_device: { subject: "New sign-in to your account", line: (extra) => `Your Appliance Desk account was just signed in to from a device we have not seen before${extra ? ` (${extra})` : ""}.` },
  sign_in_reset: { subject: "Your sign-in was reset by the owner", line: () => "The owner reset your Appliance Desk sign-in: you were signed out everywhere and two-step sign-in was turned off. Use the separate email with the link to choose a new password and set up two-step again." },
  job_role_changed: { subject: "Your job role was changed", line: (extra) => `Your job role on Appliance Desk was changed${extra ? ` to ${extra}` : ""}, which changes the screens you can open. You were signed out; sign in again to continue.` },
  two_step_changed: { subject: "Your second sign-in step was changed", line: (extra) => `The way you get your second sign-in step on Appliance Desk was changed${extra ? ` to ${extra}` : ""}.` },
  two_step_off: { subject: "Two-step sign-in was turned off", line: () => "Two-step sign-in was turned off for your Appliance Desk account and you were signed out everywhere." },
};

export type NoticeOutcome = "SENT" | "NOT_ATTEMPTED" | "REJECTED" | "UNKNOWN" | "ERROR";

/**
 * Short "this changed on your account" email so a takeover is noticed. Contains no sign-in link.
 * Returns what really happened; a failed send never undoes the change, but callers must not treat it as sent.
 */
export async function sendAccountNotice(userId: string, kind: AccountNoticeKind, options?: { to?: string; extra?: string }): Promise<NoticeOutcome> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, role: true } });
    if (!user) return "ERROR";
    const copy = NOTICE_TEXT[kind];
    const help = user.role === "OWNER"
      ? "If this wasn't you, sign in and change your password right away, then follow the account recovery steps."
      : "If this wasn't you, tell the owner right away.";
    const result = await sendEmail({
      to: options?.to ?? user.email,
      subject: copy.subject,
      text: [`Hello${user.name ? ` ${user.name}` : ""},`, copy.line(options?.extra), help].join("\n\n"),
    });
    return result.sent ? "SENT" : (result.outcome && result.outcome !== "SENT" ? result.outcome : "UNKNOWN");
  } catch {
    return "ERROR";
  }
}

/**
 * The same short "this changed on your account" email, for a customer. It goes through the customer-email
 * switch ("Send emails to customers", off to start): while that switch is off nothing is sent, and the
 * not-sent is recorded in the activity record so the owner can see the customer was not told. This is account
 * security mail, the same class as sendAccountNotice, so it uses sendCustomerEmail directly.
 */
export async function sendCustomerAccountNotice(userId: string, kind: AccountNoticeKind, options?: { extra?: string }): Promise<NoticeOutcome> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) return "ERROR";
    const copy = NOTICE_TEXT[kind];
    const result = await sendCustomerEmail({
      to: user.email,
      subject: copy.subject,
      text: [`Hello${user.name ? ` ${user.name}` : ""},`, copy.line(options?.extra), "If this wasn't you, tell us right away."].join("\n\n"),
    });
    const outcome = result.sent ? "SENT" : (result.outcome && result.outcome !== "SENT" ? result.outcome : "UNKNOWN");
    if (outcome !== "SENT") {
      try {
        await recordAccountEvent(userId, "account.notice_not_sent", { notice: kind, outcome });
      } catch {
        // The outcome below still reaches the caller.
      }
    }
    return outcome;
  } catch {
    return "ERROR";
  }
}

export const NOTICE_NOT_SENT_WARNING =
  "We could not confirm that the notice email about this change was sent. The change itself went through.";

/** Sends the notice; when it was not confirmed sent, records that in the activity record and returns a warning to show. */
export async function noticeWarning(userId: string, kind: AccountNoticeKind, options?: { to?: string; extra?: string }): Promise<string | undefined> {
  const outcome = await sendAccountNotice(userId, kind, options);
  if (outcome === "SENT") return undefined;
  try {
    await recordAccountEvent(userId, "account.notice_not_sent", { notice: kind, outcome });
  } catch {
    // The warning below still reaches the person.
  }
  return NOTICE_NOT_SENT_WARNING;
}

export type PasswordFollowUp = { signedOut: number; signOutFailed: boolean; warning?: string };

/**
 * After the library accepted a new password: end the other sessions if asked, forget remembered devices (a
 * changed password must ask for a code again everywhere), record it, send the notice. A failed sign-out is
 * reported (never counted as "no other devices") so the person can retry.
 */
export async function finishPasswordChange(
  userId: string,
  currentToken: string,
  signOutOthers: boolean,
  revoke: (userId: string, currentToken: string) => Promise<number>,
): Promise<PasswordFollowUp> {
  let signedOut = 0;
  let signOutFailed = false;
  if (signOutOthers) {
    try {
      signedOut = await revoke(userId, currentToken);
    } catch {
      signOutFailed = true;
    }
  }
  // ACC-6: a changed password forgets remembered devices. A failure here must not undo the password change
  // itself; the sign-in gate is the backstop (it removes a trust row whose device is no longer remembered).
  try {
    const { forgetTrustedDevices } = await import("@/domains/security/trusted-devices");
    await forgetTrustedDevices(userId);
  } catch (error) {
    console.error("[account] forgetting remembered devices after password change failed", error instanceof Error ? error.name : "unknown");
  }
  await recordAccountEvent(userId, "account.password_changed", { signedOutOtherDevices: signedOut, otherDevicesSignOutFailed: signOutFailed });
  const warning = await noticeWarning(userId, "password");
  return { signedOut, signOutFailed, ...(warning ? { warning } : {}) };
}

/**
 * Called by the sign-in library after an emailed link was used. When it finishes a change we started from My account,
 * record it and tell the OLD address. Any other verification (there are none today) is left alone.
 */
export async function completeEmailChange(user: { id: string; email: string }): Promise<void> {
  try {
    const request = await prisma.auditLog.findFirst({
      where: {
        userId: user.id,
        action: "account.email_change_requested",
        newValue: { path: ["newEmail"], equals: user.email },
        createdAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, newValue: true },
    });
    if (!request) return;
    const later = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "account.email_changed", createdAt: { gt: request.createdAt } },
      select: { id: true },
    });
    if (later) return;
    const detail = request.newValue as { oldEmail?: string } | null;
    await recordAccountEvent(user.id, "account.email_changed", { newEmail: user.email, oldEmail: detail?.oldEmail ?? null });
    // ACC-6: a changed sign-in email forgets remembered devices.
    const { forgetTrustedDevices } = await import("@/domains/security/trusted-devices");
    await forgetTrustedDevices(user.id);
    if (detail?.oldEmail) await noticeWarning(user.id, "email_changed", { to: detail.oldEmail, extra: maskEmail(user.email) });
  } catch {
    // The change itself already happened; a failed note must never break the sign-in flow.
  }
}
