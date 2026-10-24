import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Per-person limits for admins (Batch O-2A, design D-O2).
 *
 * Today the owner and every admin can do every money action, staff can do none. This keeps those defaults exactly, and
 * adds one thing: the owner can take a named capability away from one admin. Nothing here gives anyone MORE than they
 * have today (granting capabilities to staff widens access and waits for Chris's approval, see the O-2 card).
 */
import { CAPABILITIES, CAPABILITY_KEYS, type Capability } from "./labels";
export { CAPABILITIES, CAPABILITY_KEYS, type Capability };

export class CapabilityError extends Error {}

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}

/** Pure rule. OWNER always; ADMIN unless limited; STAFF and everyone else never (staff grants are not built yet). */
export function capabilityAllowed(role: string, overrideAllowed: boolean | null): boolean {
  if (role === "OWNER") return true;
  if (role === "ADMIN") return overrideAllowed !== false;
  return false;
}

/**
 * Same re-check as assertActiveTeamActor(tx, id, ["OWNER","ADMIN"]) (shared lock on the user row, archived or
 * wrong-role accounts refused with the same message), plus the per-person limit. Use inside the transaction that does
 * the work so a limit saved a moment ago is honoured before anything is written.
 */
export async function assertCapability(tx: Prisma.TransactionClient, userId: string, capability: Capability) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, archivedAt: true } });
  if (!user || user.archivedAt || (user.role !== "OWNER" && user.role !== "ADMIN"))
    throw new Error("This account no longer has access to make that change.");
  if (user.role === "OWNER") return user;
  const row = await tx.staffCapabilityOverride.findUnique({ where: { userId_capability: { userId, capability } } });
  if (!capabilityAllowed(user.role, row ? row.allowed : null))
    throw new CapabilityError(`The owner has not given you permission to: ${CAPABILITIES[capability].label.toLowerCase()}. Ask the owner.`);
  return user;
}

export type AdminCapabilityRow = { userId: string; name: string; email: string; limited: Capability[] };

/** Every active admin and the capabilities the owner has taken away from them. */
export async function listAdminCapabilities(): Promise<AdminCapabilityRow[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", archivedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
  });
  if (admins.length === 0) return [];
  const rows = await prisma.staffCapabilityOverride.findMany({ where: { userId: { in: admins.map((a) => a.id) }, allowed: false } });
  return admins.map((a) => ({
    userId: a.id,
    name: a.name || a.email,
    email: a.email,
    limited: rows.filter((r) => r.userId === a.id && isCapability(r.capability)).map((r) => r.capability as Capability),
  }));
}

/** Owner only. Limits (allowed=false) or restores (allowed=true) one capability for one admin, with an audit row. */
export async function setAdminCapability(ownerId: string, adminId: string, capability: string, allowed: boolean) {
  if (!isCapability(capability)) throw new CapabilityError("That permission does not exist.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR SHARE`;
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { role: true, archivedAt: true } });
    if (!owner || owner.archivedAt || owner.role !== "OWNER") throw new CapabilityError("Only the owner can change what an admin may do.");
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${adminId} FOR UPDATE`;
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, archivedAt: true } });
    if (!admin || admin.archivedAt || admin.role !== "ADMIN") throw new CapabilityError("Only an active admin can be limited. The owner always has every permission.");
    const existing = await tx.staffCapabilityOverride.findUnique({ where: { userId_capability: { userId: adminId, capability } } });
    const wasAllowed = existing ? existing.allowed : true;
    if (wasAllowed === allowed) return { changed: false };
    if (allowed) await tx.staffCapabilityOverride.delete({ where: { userId_capability: { userId: adminId, capability } } });
    else await tx.staffCapabilityOverride.upsert({
      where: { userId_capability: { userId: adminId, capability } },
      create: { userId: adminId, capability, allowed: false, updatedByUserId: ownerId },
      update: { allowed: false, updatedByUserId: ownerId },
    });
    await tx.auditLog.create({
      data: {
        userId: ownerId, action: "staff.capability", entityType: "User", entityId: adminId,
        oldValue: { capability, allowed: wasAllowed }, newValue: { capability, allowed },
      },
    });
    return { changed: true };
  });
}
