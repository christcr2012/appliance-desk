import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const UNKNOWN_HASH = createHash("sha256").update("no-checkup-key-record").digest("hex");
const hashKey = (v: string): string => createHash("sha256").update(v, "utf8").digest("hex");

export async function createOpsAgentKey(
  actorId: string, label: string,
): Promise<{ id: string; key: string }> {
  if (typeof label !== "string" || label.trim().length < 2 || label.trim().length > 80)
    throw new Error("Check-up key label must be 2–80 characters.");
  const cleanLabel = label.trim();
  const key = randomBytes(32).toString("base64url");
  const keyHash = hashKey(key);
  const id = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const created = await tx.opsAgentKey.create({
      data: { label: cleanLabel, keyHash, createdByUserId: actorId },
      select: { id: true },
    });
    await tx.auditLog.create({data:{
      action: "ops.agent_key_created", entityType: "OpsAgentKey", entityId: created.id,
      userId: actorId,
    }});
    return created.id;
  });
  return { id, key };
}

export async function revokeOpsAgentKey(actorId: string, id: string): Promise<void> {
  if (typeof id !== "string" || !/^c[a-z0-9]{10,50}$/i.test(id))
    throw new Error("Invalid check-up key reference.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.opsAgentKey.updateMany({
      where: { id, revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (changed.count !== 1) throw new Error("Key already revoked or not found.");
    await tx.auditLog.create({ data:{
      action: "ops.agent_key_revoked", entityType: "OpsAgentKey",
      entityId: id, userId: actorId,
    }});
  });
}

export async function listOpsAgentKeys(actorId: string): Promise<Array<{
  id: string; label: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null;
}>> {
  const user = await prisma.user.findUnique({
    where: {id:actorId},select:{role:true,archivedAt:true},
  });
  if (!user || user.archivedAt || user.role!=="OWNER") throw new Error("Owner access required.");
  return prisma.opsAgentKey.findMany({
    select: {id:true,label:true,createdAt:true,lastUsedAt:true,revokedAt:true},
    orderBy: [{createdAt:"desc"},{id:"desc"}],take:100,
  });
}

/** Verify a bearer without logging it, compare digest bytes in constant time. */
export async function verifyOpsAgentKey(
  bearer: string,
): Promise<{ id: string; label: string } | null> {
  if (typeof bearer !== "string" || !TOKEN_FORMAT.test(bearer)) return null;
  const computed = hashKey(bearer);
  const row = await prisma.opsAgentKey.findUnique({
    where: { keyHash: computed },
    select: { id: true, label: true, keyHash: true, revokedAt: true },
  });
  const comparison = row?.keyHash ?? UNKNOWN_HASH;
  const matched = timingSafeEqual(
    Buffer.from(computed, "hex"), Buffer.from(comparison, "hex"),
  );
  if (!matched || !row || row.revokedAt) return null;
  const updated = await prisma.opsAgentKey.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
  return updated.count === 1 ? { id: row.id, label: row.label } : null;
}
