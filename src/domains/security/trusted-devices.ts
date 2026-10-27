// ACC-6: remember this device.
//
// A device is identified by the `ad_device` cookie (32 random bytes). The cookie value itself is never stored —
// only its SHA-256 hash — and the cookie never signs anyone in on its own: it only says "this is the same
// browser as before". When a team member ticks "Remember this device" at the second step, the app remembers
// that device for the owner's number of days (BusinessSettings.trustedDeviceDays, starting at 30, 0 = always
// ask). The library's own trust row is only a backstop: it is clamped to the same date, and the sign-in gate
// (enforceTrustedDeviceGate, run before every password sign-in) removes it as soon as the device is no longer
// remembered, so trust lasts the owner's days from when it was ticked — never longer, never extended by use.

import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { normalizeAccountEmail } from "@/lib/account-provisioning";

export const DEVICE_COOKIE_NAME = "ad_device";
// A device cookie is only an identifier, so it may live longer than any remembered device (400 days, the
// longest a browser cookie is commonly kept).
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
// The library stores its own trust rows in Verification with this identifier prefix; the value is the user id.
export const TRUST_VERIFICATION_PREFIX = "trust-device-";
// Hard ceiling for the library's trust rows (the owner's shorter setting is enforced by the app on top of it).
export const TRUST_DEVICE_MAX_AGE_DAYS = 90;
export const TRUSTED_DEVICE_DAYS_DEFAULT = 30;
export const TRUSTED_DEVICE_DAYS_MIN = 0;
export const TRUSTED_DEVICE_DAYS_MAX = 90;

export function isTeamRole(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "STAFF";
}

/** SHA-256 of the device cookie value. The value itself is never stored. */
export function hashDeviceCookie(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A fresh device cookie value: 32 random bytes. */
export function newDeviceCookieValue(): string {
  return randomBytes(32).toString("base64url");
}

export function validateTrustedDeviceDays(days: unknown): number {
  // Number(null) is 0, so a missing value must be refused outright rather than read as "off".
  if (days === null || days === undefined) {
    throw new Error(`Remember devices must be a whole number of days from ${TRUSTED_DEVICE_DAYS_MIN} to ${TRUSTED_DEVICE_DAYS_MAX}.`);
  }
  const n = Number(days);
  if (!Number.isInteger(n) || n < TRUSTED_DEVICE_DAYS_MIN || n > TRUSTED_DEVICE_DAYS_MAX) {
    throw new Error(`Remember devices must be a whole number of days from ${TRUSTED_DEVICE_DAYS_MIN} to ${TRUSTED_DEVICE_DAYS_MAX}.`);
  }
  return n;
}

/** The date until which a device ticked now stays remembered, or null when remembering is off. */
export function trustedUntilFor(days: number, now = new Date()): Date | null {
  if (days <= 0) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

async function trustedDeviceDaysSetting(): Promise<number> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { trustedDeviceDays: true } });
  return row?.trustedDeviceDays ?? TRUSTED_DEVICE_DAYS_DEFAULT;
}

export async function getTrustedDeviceSettings(): Promise<{ days: number }> {
  return { days: await trustedDeviceDaysSetting() };
}

/**
 * Owner only. Lowering the number also shortens every remembered device (0 forgets them all at once), so a
 * device is never remembered longer than the setting in force.
 */
export async function updateTrustedDeviceSettings(ownerId: string, input: { days: unknown }): Promise<{ days: number }> {
  const days = validateTrustedDeviceDays(input.days);
  await prisma.$transaction(async (tx) => {
    await updateTrustedDeviceSettingsInTx(tx, ownerId, days);
  });
  return { days };
}

export async function updateTrustedDeviceSettingsInTx(tx: Prisma.TransactionClient, ownerId: string, days: number): Promise<void> {
  validateTrustedDeviceDays(days);
  await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
  const before = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { trustedDeviceDays: true } });
  await tx.businessSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", trustedDeviceDays: days },
    update: { trustedDeviceDays: days },
  });
  const until = trustedUntilFor(days, new Date());
  if (until) {
    await tx.knownDevice.updateMany({ where: { trustedUntil: { gt: until } }, data: { trustedUntil: until } });
    await tx.verification.updateMany({
      where: { identifier: { startsWith: TRUST_VERIFICATION_PREFIX }, expiresAt: { gt: until } },
      data: { expiresAt: until },
    });
  } else {
    await tx.verification.deleteMany({ where: { identifier: { startsWith: TRUST_VERIFICATION_PREFIX } } });
    await tx.knownDevice.updateMany({ where: { trustedUntil: { not: null } }, data: { trustedUntil: null, forgottenAt: new Date() } });
  }
  await tx.auditLog.create({
    data: { userId: ownerId, action: "security.trusted_device_settings", entityType: "BusinessSettings", entityId: "singleton", oldValue: before ?? {}, newValue: { days } },
  });
}

/**
 * Forget remembered devices for one person: every library trust row for them is removed, and their devices stop
 * being remembered. The library's rows cannot be tied to one device, so forgetting one device forgets them all;
 * when deviceId is given, that device alone is also marked forgotten. Callers pass their own transaction when
 * the forget is part of a bigger change (password change, removal, and so on). When assertActor is set (the
 * staff-facing forget on My account), the actor is re-checked inside the transaction first: if the person was
 * deactivated after the page's role check but before this runs, nothing is deleted. Internal cleanup callers
 * (password, reset, email, method changes, owner actions) do not pass it, so they are unchanged.
 */
export async function forgetTrustedDevices(
  userId: string,
  options?: { deviceId?: string; assertActor?: boolean },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (options?.assertActor) {
      await assertActiveTeamActor(tx, userId);
    }
    await forgetTrustedDevicesInTx(tx, userId, { deviceId: options?.deviceId });
  });
}

export async function forgetTrustedDevicesInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  options?: { deviceId?: string },
): Promise<void> {
  await tx.verification.deleteMany({ where: { identifier: { startsWith: TRUST_VERIFICATION_PREFIX }, value: userId } });
  const now = new Date();
  if (options?.deviceId) {
    await tx.knownDevice.updateMany({ where: { id: options.deviceId, userId }, data: { trustedUntil: null, forgottenAt: now } });
  } else {
    await tx.knownDevice.updateMany({ where: { userId }, data: { trustedUntil: null, forgottenAt: now } });
  }
  await tx.auditLog.create({
    data: {
      userId,
      action: "security.trusted_devices_forgotten",
      entityType: "User",
      entityId: userId,
      newValue: options?.deviceId ? { deviceId: options.deviceId } : {},
    },
  });
}

/** The person's devices that have not been forgotten, most recently used first. */
export async function listOwnKnownDevices(userId: string): Promise<{ id: string; label: string; lastSeenAt: Date; trustedUntil: Date | null }[]> {
  return prisma.knownDevice.findMany({
    where: { userId, forgottenAt: null },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, label: true, lastSeenAt: true, trustedUntil: true },
  });
}

/** Remember one device until the given date (set when the person ticks "Remember this device"). */
export async function markDeviceTrusted(userId: string, deviceHash: string, until: Date): Promise<void> {
  await prisma.knownDevice.updateMany({ where: { userId, deviceHash }, data: { trustedUntil: until, forgottenAt: null } });
}

/**
 * Shorten the library trust row created by this very sign-in to the same date the device is remembered until.
 * The row is the newest trust row for the person (created moments ago by this request); a row made by an
 * earlier request is never touched. The sign-in gate is what really enforces the date — this only keeps the
 * stored row from outliving it.
 */
export async function clampNewestTrustRow(userId: string, until: Date, now = new Date()): Promise<void> {
  const row = await prisma.verification.findFirst({
    where: {
      identifier: { startsWith: TRUST_VERIFICATION_PREFIX },
      value: userId,
      createdAt: { gte: new Date(now.getTime() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, expiresAt: true },
  });
  if (!row || row.expiresAt.getTime() <= until.getTime()) return;
  await prisma.verification.update({ where: { id: row.id }, data: { expiresAt: until } });
}

/**
 * Before a password sign-in: if the browser presents a trust cookie for a device that is no longer remembered
 * (its remembered-until date passed, or this device was never remembered), remove the library's trust row so
 * the sign-in asks for a code. Never throws: a failure here must not stop a sign-in (the row's own expiry is
 * the backstop, and the next sign-in tries the gate again).
 */
export async function enforceTrustedDeviceGate(input: {
  email: string | null;
  trustCookieValue: string | null;
  deviceCookie: string | null;
  now?: Date;
}): Promise<void> {
  try {
    const now = input.now ?? new Date();
    if (!input.trustCookieValue) return;
    const identifier = input.trustCookieValue.split("!").pop() ?? "";
    if (!identifier.startsWith(TRUST_VERIFICATION_PREFIX)) return;
    const row = await prisma.verification.findFirst({ where: { identifier }, select: { value: true, expiresAt: true } });
    if (!row || row.expiresAt.getTime() <= now.getTime()) return;
    const user = input.email
      ? await prisma.user.findUnique({ where: { email: normalizeAccountEmail(input.email) }, select: { id: true, role: true } })
      : null;
    if (!user || row.value !== user.id) return;
    // ACCT-1: an accountant always enters a code — a trust row left over from
    // before the person became an accountant must never skip it.
    if (user.role === "ACCOUNTANT") {
      await prisma.verification.deleteMany({ where: { identifier } });
      return;
    }
    const deviceHash = input.deviceCookie ? hashDeviceCookie(input.deviceCookie) : null;
    const device = deviceHash
      ? await prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId: user.id, deviceHash } }, select: { trustedUntil: true } })
      : null;
    if (device?.trustedUntil && device.trustedUntil.getTime() > now.getTime()) return;
    // This device is not remembered (or its remembered-until date passed): the trust row must not skip the code.
    await prisma.verification.deleteMany({ where: { identifier } });
  } catch (error) {
    console.error("[trusted-devices] trust gate failed", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Before a two-step verify: the app only trusts a device when the owner allows it (days above 0) and only for
 * team members — customers have no second step. Returns true when the request's trustDevice must be ignored.
 * Never throws: on a failure the request is left alone, and the sign-in gate plus the follow-up clamp are the
 * backstops.
 */
export async function shouldStripTrustDevice(input: {
  trustDevice: unknown;
  sessionUserId: string | null;
  twoFactorCookieValue: string | null;
}): Promise<boolean> {
  try {
    if (input.trustDevice !== true) return false;
    const days = await trustedDeviceDaysSetting();
    if (days <= 0) return true;
    let userId = input.sessionUserId;
    if (!userId && input.twoFactorCookieValue) {
      const row = await prisma.verification.findFirst({ where: { identifier: input.twoFactorCookieValue }, select: { value: true } });
      userId = row?.value ?? null;
    }
    if (!userId) return false;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return false;
    return !isTeamRole(user.role);
  } catch (error) {
    console.error("[trusted-devices] trust strip check failed", error instanceof Error ? error.name : "unknown");
    return false;
  }
}
