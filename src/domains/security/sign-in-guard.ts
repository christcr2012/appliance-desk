import { prisma } from "@/lib/prisma";
import { normalizeAccountEmail } from "@/lib/account-provisioning";
import { sendAccountNotice } from "@/domains/account";
import { nextFailureState, pauseMessage, PAUSE_ATTEMPTS_DEFAULT, PAUSE_MINUTES_DEFAULT, validatePauseSettings } from "./sign-in-guard-rules";
import { sessionDeviceLabel } from "./sessions";
import { assertActiveTeamActor } from "@/lib/team-actor";

// ACC-4: wrong-password pause per account, and "new device" notices. The existing per-address rate limit stays as is.
// Nothing here may ever block a correct sign-in by throwing, so callers wrap these in try/catch.

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
 * Finished sign-in. For the team only: a device (kind of device and browser) not seen before gets a notice. The first
 * ever sign-in just records the device. Only new devices are written down, so the activity record stays quiet.
 */
export async function noteCompletedSignIn(userId: string, userAgent: string | null): Promise<"first" | "known" | "new" | "skipped"> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "STAFF")) return "skipped";
  const device = sessionDeviceLabel(userAgent);
  const seen = await prisma.auditLog.findMany({ where: { userId, action: "account.sign_in_device" }, select: { newValue: true }, take: 200 });
  const known = seen.some((row) => (row.newValue as { device?: string } | null)?.device === device);
  if (known) return "known";
  await prisma.auditLog.create({ data: { userId, action: "account.sign_in_device", entityType: "User", entityId: userId, newValue: { device } } });
  if (seen.length === 0) return "first";
  await sendAccountNotice(userId, "new_device", { extra: device });
  return "new";
}
