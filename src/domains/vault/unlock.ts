import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { sendAccountNotice } from "@/domains/account";
import { VAULT_FAIL_LIMIT, VAULT_FAIL_WINDOW_MINUTES, VAULT_LOCK_MINUTES, VAULT_UNLOCK_MINUTES } from "./rules";

/**
 * VAULT-2: the unlock lifecycle (spec §5). Better Auth verifies the code
 * itself (the vault's server actions call its two-factor server functions
 * with the owner's own method); this module keeps the bookkeeping: a
 * VaultUnlock row per (owner, session) for 5 minutes, and a lockout derived
 * from the failed-attempt audit rows — 5 failures inside 15 minutes lock
 * the vault until 30 minutes after the latest failure. The lock is derived,
 * never a stored flag, so nothing can flip it off except time.
 */

export class VaultError extends Error {}

export type VaultUnlockStatus = {
  unlocked: boolean;
  expiresAt: Date | null;
  locked: boolean;
  lockedUntil: Date | null;
};

function denverTime(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

async function failuresInWindow(userId: string, now: Date): Promise<Date[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      userId,
      action: "vault.unlock_failed",
      createdAt: { gt: new Date(now.getTime() - VAULT_FAIL_WINDOW_MINUTES * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return rows.map((r) => r.createdAt);
}

function lockFrom(failures: Date[], now: Date): { locked: boolean; lockedUntil: Date | null } {
  if (failures.length < VAULT_FAIL_LIMIT) return { locked: false, lockedUntil: null };
  const latest = failures[0];
  const lockedUntil = new Date(latest.getTime() + VAULT_LOCK_MINUTES * 60_000);
  return lockedUntil > now ? { locked: true, lockedUntil } : { locked: false, lockedUntil: null };
}

export async function getVaultUnlockStatus(userId: string, sessionId: string, now = new Date()): Promise<VaultUnlockStatus> {
  const [unlock, failures] = await Promise.all([
    prisma.vaultUnlock.findFirst({
      where: { userId, sessionId, expiresAt: { gt: now } },
      orderBy: { expiresAt: "desc" },
      select: { expiresAt: true },
    }),
    failuresInWindow(userId, now),
  ]);
  const lock = lockFrom(failures, now);
  return {
    unlocked: Boolean(unlock) && !lock.locked,
    expiresAt: unlock?.expiresAt ?? null,
    locked: lock.locked,
    lockedUntil: lock.lockedUntil,
  };
}

/** Throws a plain-words VaultError unless this session holds a live unlock and the vault is not locked. */
export async function requireVaultUnlock(userId: string, sessionId: string, now = new Date()): Promise<void> {
  const status = await getVaultUnlockStatus(userId, sessionId, now);
  if (status.locked) {
    throw new VaultError(`The vault is locked until ${denverTime(status.lockedUntil!)} because of too many wrong codes.`);
  }
  if (!status.unlocked) {
    throw new VaultError("Unlock the vault with a fresh sign-in code first.");
  }
}

/**
 * Records a successful fresh-code verification (Better Auth has already
 * checked the code in the calling server action). Refuses while locked.
 */
export async function grantVaultUnlock(userId: string, sessionId: string, now = new Date()): Promise<Date> {
  const failures = await failuresInWindow(userId, now);
  const lock = lockFrom(failures, now);
  if (lock.locked) {
    throw new VaultError(`The vault is locked until ${denverTime(lock.lockedUntil!)} because of too many wrong codes.`);
  }
  const expiresAt = new Date(now.getTime() + VAULT_UNLOCK_MINUTES * 60_000);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    await tx.vaultUnlock.create({ data: { userId, sessionId, expiresAt } });
    await tx.auditLog.create({
      data: { userId, action: "vault.unlocked", entityType: "Vault", entityId: userId, newValue: { minutes: VAULT_UNLOCK_MINUTES } },
    });
  });
  return expiresAt;
}

/**
 * Records one failed code. When the failure is the one that trips the limit,
 * the owner is emailed (the account-notice path) and the lock is audited.
 */
export async function recordFailedVaultUnlock(userId: string, now = new Date()): Promise<VaultUnlockStatus> {
  await prisma.auditLog.create({
    data: { userId, action: "vault.unlock_failed", entityType: "Vault", entityId: userId, newValue: {} },
  });
  const failures = await failuresInWindow(userId, now);
  const lock = lockFrom(failures, now);
  if (lock.locked && failures.length === VAULT_FAIL_LIMIT) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "vault.locked",
        entityType: "Vault",
        entityId: userId,
        newValue: { lockedUntil: lock.lockedUntil!.toISOString() },
      },
    });
    await sendAccountNotice(userId, "vault_locked", { extra: denverTime(lock.lockedUntil!) });
  }
  return { unlocked: false, expiresAt: null, locked: lock.locked, lockedUntil: lock.lockedUntil };
}

/** Deletes every unlock for the user inside the caller's transaction (sign-out-everywhere, password/second-step change). */
export async function clearVaultUnlocksInTx(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.vaultUnlock.deleteMany({ where: { userId } });
}

export async function clearVaultUnlocks(userId: string): Promise<void> {
  await prisma.vaultUnlock.deleteMany({ where: { userId } });
}
