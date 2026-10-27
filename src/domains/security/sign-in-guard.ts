import { prisma } from "@/lib/prisma";
import { normalizeAccountEmail } from "@/lib/account-provisioning";
import { sendAccountNotice, sendCustomerAccountNotice } from "@/domains/account";
import { nextFailureState, pauseMessage, PAUSE_ATTEMPTS_DEFAULT, PAUSE_MINUTES_DEFAULT, validatePauseSettings } from "./sign-in-guard-rules";
import { sessionDeviceLabel } from "./sessions";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  clampNewestTrustRow,
  forgetTrustedDevices,
  getTrustedDeviceSettings,
  hashDeviceCookie,
  markDeviceTrusted,
  newDeviceCookieValue,
  trustedUntilFor,
} from "./trusted-devices";

// ACC-4: wrong-password pause per account, and "new device" notices. The existing per-address rate limit stays as is.
// ACC-6: devices are keyed by the device cookie now (a second phone of the same kind is new), and the follow-up
// below also records a ticked "Remember this device". Nothing here may ever block a correct sign-in by throwing,
// so callers wrap these in try/catch.

async function pauseSettings() {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { signInPauseAttempts: true, signInPauseMinutes: true } });
  return { attempts: row?.signInPauseAttempts ?? PAUSE_ATTEMPTS_DEFAULT, minutes: row?.signInPauseMinutes ?? PAUSE_MINUTES_DEFAULT };
}

export async function getPauseSettings() {
  return pauseSettings();
}

/** Owner only. */
export async function updatePauseSettings(ownerId: string, input: { attempts: unknown; minutes: unknown }) {
  const next = validatePauseSettings(input.attempts, input.minutes);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    const before = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { signInPauseAttempts: true, signInPauseMinutes: true } });
    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", signInPauseAttempts: next.attempts, signInPauseMinutes: next.minutes },
      update: { signInPauseAttempts: next.attempts, signInPauseMinutes: next.minutes },
    });
    await tx.auditLog.create({
      data: { userId: ownerId, action: "security.sign_in_pause_settings", entityType: "BusinessSettings", entityId: "singleton", oldValue: before ?? {}, newValue: { attempts: next.attempts, minutes: next.minutes } },
    });
  });
  return next;
}

/** The message to show while an account is paused, or null when sign-in may be tried. */
export async function pausedMessageFor(email: string, now = new Date()): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeAccountEmail(email) }, select: { signInPausedUntil: true } });
  if (!user?.signInPausedUntil || user.signInPausedUntil.getTime() <= now.getTime()) return null;
  return pauseMessage(user.signInPausedUntil, now);
}

/** One more wrong password for this address. Unknown addresses are ignored (nothing to pause). */
export async function recordFailedSignIn(email: string, now = new Date()): Promise<{ justPaused: boolean; userId: string | null }> {
  const normalized = normalizeAccountEmail(email);
  const { attempts, minutes } = await pauseSettings();
  const result = await prisma.$transaction(async (tx) => {
    const found = await tx.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (!found) return null;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${found.id} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: found.id }, select: { failedSignInCount: true, failedSignInWindowStartedAt: true, signInPausedUntil: true } });
    // Already paused: tries during the wait do not extend or restart anything.
    if (user.signInPausedUntil && user.signInPausedUntil.getTime() > now.getTime()) return { userId: found.id, justPaused: false };
    const next = nextFailureState({ count: user.failedSignInCount, windowStartedAt: user.failedSignInWindowStartedAt }, now, attempts, minutes);
    await tx.user.update({ where: { id: found.id }, data: { failedSignInCount: next.count, failedSignInWindowStartedAt: next.windowStartedAt, signInPausedUntil: next.pausedUntil } });
    if (next.justPaused) {
      await tx.auditLog.create({ data: { userId: found.id, action: "security.sign_in_paused", entityType: "User", entityId: found.id, newValue: { until: next.pausedUntil!.toISOString(), attempts, minutes } } });
    }
    return { userId: found.id, justPaused: next.justPaused };
  });
  if (!result) return { justPaused: false, userId: null };
  if (result.justPaused) await sendAccountNotice(result.userId, "sign_in_paused");
  return result;
}

/** A correct password clears the count (and any finished pause). */
export async function recordPasswordAccepted(userId: string) {
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ failedSignInCount: { gt: 0 } }, { failedSignInWindowStartedAt: { not: null } }, { signInPausedUntil: { not: null } }] },
    data: { failedSignInCount: 0, failedSignInWindowStartedAt: null, signInPausedUntil: null },
  });
}

/**
 * Finished sign-in. A device the person has not signed in from before gets a notice; the first ever sign-in just
 * records the device. Only new devices are written down, so the activity record stays quiet. Devices are keyed
 * by the device cookie, so a second phone of the same kind is new (the old check compared only the kind of
 * device and browser, and never noticed a second phone). Team members get the notice by email; customers get it
 * through the customer-email switch, and when that switch is off it is recorded as not sent.
 */
export async function noteCompletedSignIn(
  userId: string,
  userAgent: string | null,
  deviceCookie: string | null,
): Promise<"first" | "known" | "new" | "skipped"> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "STAFF" && user.role !== "CUSTOMER" && user.role !== "ACCOUNTANT")) return "skipped";
  const device = sessionDeviceLabel(userAgent);
  // Without a cookie there is nothing to key the device on; fall back to the device kind so the sign-in is
  // still recorded (the sign-in follow-up always passes a cookie, so this is only for direct callers).
  const deviceHash = deviceCookie ? hashDeviceCookie(deviceCookie) : hashDeviceCookie(`label:${device}`);
  const existing = await prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash } }, select: { id: true } });
  const hadAny = await prisma.knownDevice.count({ where: { userId } });
  await prisma.knownDevice.upsert({
    where: { userId_deviceHash: { userId, deviceHash } },
    create: { userId, deviceHash, label: device },
    update: { lastSeenAt: new Date(), label: device, forgottenAt: null },
  });
  if (existing) return "known";
  await prisma.auditLog.create({ data: { userId, action: "account.sign_in_device", entityType: "User", entityId: userId, newValue: { device } } });
  if (hadAny === 0) return "first";
  if (user.role === "CUSTOMER") await sendCustomerAccountNotice(userId, "new_device", { extra: device });
  else await sendAccountNotice(userId, "new_device", { extra: device });
  return "new";
}

/**
 * The sign-in follow-up, run after the two-step plugin has decided the sign-in (so a sign-in that is still
 * waiting for a code is never noted here). It makes sure the browser has a device cookie, records the device,
 * and — when the person ticked "Remember this device", or when a trusted sign-in rotated the library's trust
 * row — keeps the remembered-until date to the owner's number of days, never longer. Never throws: a failure
 * here must not stop or change a sign-in (the sign-in gate is the backstop for trust).
 */
export async function completeSignInFollowUp(input: {
  userId: string;
  userAgent: string | null;
  /** The two-step verify asked to remember this device. */
  trustDeviceRequested: boolean;
  /** A password sign-in arrived with a trust cookie (the plugin rotated its trust row). */
  trustCookiePresented: boolean;
  deviceCookie: string | null;
  setDeviceCookie: (value: string) => void;
  now?: Date;
}): Promise<void> {
  try {
    const now = input.now ?? new Date();
    let deviceCookie = input.deviceCookie;
    if (!deviceCookie) {
      deviceCookie = newDeviceCookieValue();
      input.setDeviceCookie(deviceCookie);
    }
    await noteCompletedSignIn(input.userId, input.userAgent, deviceCookie);
    const deviceHash = hashDeviceCookie(deviceCookie);
    if (input.trustDeviceRequested) {
      const { days } = await getTrustedDeviceSettings();
      if (days <= 0) {
        // Remembering is off: a trust row created anyway (for example if the strip was bypassed) must not survive.
        await forgetTrustedDevices(input.userId);
        return;
      }
      const until = trustedUntilFor(days, now)!;
      await markDeviceTrusted(input.userId, deviceHash, until);
      await clampNewestTrustRow(input.userId, until, now);
    } else if (input.trustCookiePresented) {
      // Rotation made a fresh trust row: keep it to the date this device is remembered until, never longer.
      const device = await prisma.knownDevice.findUnique({
        where: { userId_deviceHash: { userId: input.userId, deviceHash } },
        select: { trustedUntil: true },
      });
      if (device?.trustedUntil) await clampNewestTrustRow(input.userId, device.trustedUntil, now);
    }
  } catch (error) {
    console.error("[auth] sign-in follow-up failed", error instanceof Error ? error.name : "unknown");
  }
}
